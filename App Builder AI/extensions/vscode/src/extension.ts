import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { unzipSync } from 'fflate';

type OpenRequest = {
  appUrl: string;
  projectId: string;
  artifactSlug: string;
};

type Project = {
  id: string;
  name: string;
  slug: string;
  workspace: { slug: string };
  artifacts: Array<{ id: string; slug: string; name: string }>;
};

type RemoteFile = {
  path: string;
  updatedAt: string;
};

const STATE_FILE = '.appweaver/state.json';
const ignored = /(^|[/\\])(?:\.git|node_modules|\.appweaver)(?:[/\\]|$)/;

export function activate(context: vscode.ExtensionContext) {
  const provider = new AppWeaverUriHandler(context);
  context.subscriptions.push(
    vscode.window.registerUriHandler(provider),
    vscode.commands.registerCommand('appweaver.open', () => provider.openFromCommand()),
    vscode.commands.registerCommand('appweaver.authenticate', () => provider.authenticate()),
    vscode.commands.registerCommand('appweaver.ask', () => provider.askAboutSelection()),
  );
  void provider.restoreWorkspace();
}

class AppWeaverUriHandler implements vscode.UriHandler {
  private watcher: vscode.FileSystemWatcher | undefined;
  private syncTimer: NodeJS.Timeout | undefined;
  private request: OpenRequest | null = null;
  private remoteFiles = new Map<string, string>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  async restoreWorkspace() {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) return;
    const state = await this.readState(folder);
    if (!state?.request) return;

    try {
      const token = await this.getToken(state.request.appUrl);
      this.request = state.request;
      await this.loadRemoteFiles(state.request, token);
      this.watch(folder);
    } catch {
      vscode.window.showWarningMessage(
        'AppWeaver could not reconnect this workspace. Run AppWeaver: Sign In to reconnect.',
      );
    }
  }

  async handleUri(uri: vscode.Uri) {
    const params = new URLSearchParams(uri.query);
    const appUrl = params.get('appUrl');
    const projectId = params.get('projectId');
    const artifactSlug = params.get('artifactSlug');

    if (!appUrl || !projectId || !artifactSlug) {
      vscode.window.showErrorMessage('This AppWeaver link is missing project details.');
      return;
    }

    await this.open({ appUrl, projectId, artifactSlug });
  }

  async openFromCommand() {
    const appUrl = await vscode.window.showInputBox({
      prompt: 'AppWeaver AI URL',
      value: 'https://appweaver.ai',
      ignoreFocusOut: true,
    });
    if (!appUrl) return;

    const projectId = await vscode.window.showInputBox({
      prompt: 'Project ID',
      ignoreFocusOut: true,
    });
    const artifactSlug = await vscode.window.showInputBox({
      prompt: 'Artifact slug',
      value: 'main',
      ignoreFocusOut: true,
    });
    if (!projectId || !artifactSlug) return;

    await this.open({ appUrl: appUrl.replace(/\/$/, ''), projectId, artifactSlug });
  }

  async authenticate() {
    const appUrl = await vscode.window.showInputBox({
      prompt: 'AppWeaver AI URL',
      value: 'https://appweaver.ai',
    });
    if (!appUrl) return;
    await this.getToken(appUrl.replace(/\/$/, ''), true);
    vscode.window.showInformationMessage('AppWeaver AI is connected to VS Code.');
  }

  async askAboutSelection() {
    const editor = vscode.window.activeTextEditor;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!editor || !folder) {
      vscode.window.showWarningMessage('Open an AppWeaver project and select code first.');
      return;
    }

    const state = await this.readState(folder.uri.fsPath);
    if (!state?.request) {
      vscode.window.showWarningMessage('This folder is not connected to AppWeaver AI.');
      return;
    }

    const selected = editor.document.getText(editor.selection);
    const request = await vscode.window.showInputBox({
      prompt: 'What should AppWeaver AI do with this code?',
      placeHolder: 'Explain, refactor, fix, or extend the selected code',
      ignoreFocusOut: true,
    });
    if (!request) return;

    const project = await this.getProject(state.request);
    const artifact = project?.artifacts.find(
      (item) => item.slug === state.request.artifactSlug,
    );
    if (!artifact) {
      vscode.window.showErrorMessage('The connected AppWeaver artifact no longer exists.');
      return;
    }

    const token = await this.getToken(state.request.appUrl);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'AppWeaver AI is working...' },
      async () => {
        const response = await fetch(
          `${state.request.appUrl}/api/projects/${state.request.projectId}/agent`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              artifactId: artifact.id,
              content: `${request}\n\nSelected file: ${path.relative(folder.uri.fsPath, editor.document.uri.fsPath)}\n\n${selected}`,
            }),
          },
        );
        if (!response.ok) throw new Error(`AI request failed (${response.status}).`);
        await response.text();
        await this.refreshWorkspace(state.request);
      },
    );
    vscode.window.showInformationMessage('AppWeaver AI changes are now in your workspace.');
  }

  private async open(request: OpenRequest) {
    const token = await this.getToken(request.appUrl);
    const folder = path.join(
      this.context.globalStorageUri.fsPath,
      'workspaces',
      request.projectId,
      request.artifactSlug,
    );
    await fs.mkdir(folder, { recursive: true });

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Opening AppWeaver project...' },
      async () => {
        await this.downloadAndExtract(request, token, folder);
        await this.writeState(folder, request);
        await this.loadRemoteFiles(request, token);
      },
    );

    this.request = request;
    this.watch(folder);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folder), false);
  }

  private async getToken(appUrl: string, force = false): Promise<string> {
    const accessKey = `token:${appUrl}`;
    const refreshKey = `refresh:${appUrl}`;
    const expiresKey = `expires:${appUrl}`;
    if (!force) {
      const existing = await this.context.secrets.get(accessKey);
      const expiresAt = this.context.globalState.get<number>(expiresKey) ?? 0;
      if (existing && expiresAt > Date.now() + 30_000) return existing;

      const refreshToken = await this.context.secrets.get(refreshKey);
      if (refreshToken) {
        try {
          const rotated = await this.jsonRequest<{
            access_token: string;
            refresh_token: string;
            expires_in: number;
          }>(`${appUrl}/api/cli/token/refresh`, {
            method: 'POST',
            body: JSON.stringify({ refresh_token: refreshToken }),
          });
          await this.storeTokens(
            appUrl,
            rotated.access_token,
            rotated.refresh_token,
            rotated.expires_in,
          );
          return rotated.access_token;
        } catch {
          await this.context.secrets.delete(refreshKey);
        }
      }
    }

    const start = await this.jsonRequest<{
      device_code: string;
      verification_uri_complete: string;
      interval: number;
    }>(`${appUrl}/api/cli/device/code`, {
      method: 'POST',
      body: JSON.stringify({ clientName: 'AppWeaver VS Code extension' }),
    });

    await vscode.env.openExternal(vscode.Uri.parse(start.verification_uri_complete));
    await vscode.window.showInformationMessage(
      'Approve the AppWeaver connection in your browser, then return to VS Code.',
    );

    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, start.interval * 1000));
      const result = await this.jsonRequest<{
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
      }>(
        `${appUrl}/api/cli/device/token`,
        {
          method: 'POST',
          body: JSON.stringify({ device_code: start.device_code }),
        },
      );
      if (result.access_token) {
        await this.storeTokens(
          appUrl,
          result.access_token,
          result.refresh_token,
          result.expires_in,
        );
        return result.access_token;
      }
      if (result.error && !['authorization_pending', 'slow_down'].includes(result.error)) {
        throw new Error(`AppWeaver authorization failed: ${result.error}`);
      }
    }

    throw new Error('AppWeaver authorization timed out.');
  }

  private async storeTokens(
    appUrl: string,
    accessToken: string,
    refreshToken?: string,
    expiresIn = 900,
  ) {
    await this.context.secrets.store(`token:${appUrl}`, accessToken);
    if (refreshToken) {
      await this.context.secrets.store(`refresh:${appUrl}`, refreshToken);
    }
    await this.context.globalState.update(
      `expires:${appUrl}`,
      Date.now() + expiresIn * 1000,
    );
  }

  private async downloadAndExtract(request: OpenRequest, token: string, folder: string) {
    const response = await fetch(
      `${request.appUrl}/api/projects/${request.projectId}/artifacts/${request.artifactSlug}/download`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw new Error(`Project download failed (${response.status}).`);
    const archive = new Uint8Array(await response.arrayBuffer());
    const files = unzipSync(archive);
    for (const [relative, content] of Object.entries(files)) {
      const target = path.resolve(folder, relative);
      if (!target.startsWith(path.resolve(folder) + path.sep)) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
    }
  }

  private async loadRemoteFiles(request: OpenRequest, token: string) {
    const data = await this.jsonRequest<{ files: RemoteFile[] }>(
      `${request.appUrl}/api/cli/projects/${request.projectId}/artifacts/${request.artifactSlug}/files`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    this.remoteFiles = new Map(data.files.map((file) => [file.path, file.updatedAt]));
  }

  private watch(folder: string) {
    this.watcher?.dispose();
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(folder), '**/*'),
    );
    const schedule = () => {
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => void this.sync(folder), 800);
    };
    this.watcher.onDidCreate(schedule, this.context.subscriptions);
    this.watcher.onDidChange(schedule, this.context.subscriptions);
    this.watcher.onDidDelete(schedule, this.context.subscriptions);
    this.context.subscriptions.push(this.watcher);
  }

  private async sync(folder: string) {
    if (!this.request) return;
    const token = await this.getToken(this.request.appUrl);
    const files = await collectTextFiles(folder);
    const currentPaths = new Set(files.map((file) => file.path));
    const deletedPaths = [...this.remoteFiles.entries()]
      .filter(([filePath]) => !currentPaths.has(filePath))
      .map(([filePath, baseUpdatedAt]) => ({ path: filePath, baseUpdatedAt }));

    const response = await fetch(
      `${this.request.appUrl}/api/cli/projects/${this.request.projectId}/artifacts/${this.request.artifactSlug}/files`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          files: files.map((file) => ({
            path: file.path,
            content: file.content,
            baseUpdatedAt: this.remoteFiles.get(file.path) ?? null,
          })),
          deletedPaths,
        }),
      },
    );

    if (response.status === 409) {
      vscode.window.showWarningMessage('AppWeaver found remote changes. Pull before syncing local edits.');
      return;
    }
    if (!response.ok) {
      vscode.window.showErrorMessage(`AppWeaver sync failed (${response.status}).`);
      return;
    }

    await this.loadRemoteFiles(this.request, token);
  }

  private async refreshWorkspace(request: OpenRequest) {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) return;
    const token = await this.getToken(request.appUrl);
    await this.downloadAndExtract(request, token, folder);
    await this.loadRemoteFiles(request, token);
  }

  private async getProject(request: OpenRequest) {
    const token = await this.getToken(request.appUrl);
    const data = await this.jsonRequest<{ projects: Project[] }>(
      `${request.appUrl}/api/cli/projects`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return data.projects.find((project) => project.id === request.projectId) ?? null;
  }

  private async writeState(folder: string, request: OpenRequest) {
    const stateDir = path.join(folder, '.appweaver');
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      path.join(stateDir, 'state.json'),
      JSON.stringify({ request }, null, 2),
      'utf8',
    );
  }

  private async readState(folder: string): Promise<{ request: OpenRequest } | null> {
    try {
      return JSON.parse(await fs.readFile(path.join(folder, STATE_FILE), 'utf8'));
    } catch {
      return null;
    }
  }

  private async jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status}).`);
    return body as T;
  }
}

async function collectTextFiles(folder: string, current = '') {
  const result: Array<{ path: string; content: string }> = [];
  const directory = path.join(folder, current);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.join(current, entry.name);
    if (ignored.test(relative)) continue;
    const fullPath = path.join(folder, relative);
    if (entry.isDirectory()) {
      result.push(...(await collectTextFiles(folder, relative)));
      continue;
    }
    const content = await fs.readFile(fullPath);
    if (content.includes(0)) continue;
    result.push({ path: relative.replace(/\\/g, '/'), content: content.toString('utf8') });
  }
  return result;
}

export function deactivate() {
  // VS Code disposes registered watchers and secrets with the extension context.
}
