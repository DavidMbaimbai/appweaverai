'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { streamAgentRequest } from '@/lib/agent/stream-client';
import {
  idleAgentActivity,
  type AgentActivity,
  fileNameFromAgentPath,
} from '@/lib/agent/agent-activity';
import {
  dedupeFileWrites,
  getNonFileSteps,
  normalizeFileContent,
} from '@/lib/agent/step-utils';
import type {
  AgentFileWriteSnapshot,
  AgentStep,
  AgentStreamEvent,
} from '@/lib/agent/types';
import {
  artifactHasFiles,
  artifactSupportsAgentBuild,
} from '@/lib/artifact-types';
import type { AppAgentMessage, AppProjectDetail } from '@/lib/app-types';
import { artifactTypeLabels } from '@/lib/app-types';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { AgentActionSteps } from './agent-action-steps';
import { AgentWorkingBadge } from './agent-activity-indicator';
import { AgentFileWriteStream } from './agent-file-write-stream';
import { AgentMessageContent } from './agent-message-content';
import { AgentPlanQuestion } from './agent-plan-question';
import { TaskBoardDrawer, WorkingIndicator } from './task-board-drawer';

type AgentPanelProps = {
  project: AppProjectDetail;
  activeArtifactId: string | null;
  onPreviewVersionChange: (delta: number) => void;
  onAgentRunComplete?: (result: {
    artifactId: string;
    buildValid: boolean;
    previewVersion: number;
  }) => void;
  onAgentActivityChange?: (activity: AgentActivity) => void;
};

type LiveRunState = {
  working: boolean;
  actionCount: number;
  steps: AgentStep[];
  fileWrites: AgentFileWriteSnapshot[];
  summary?: string;
  planQuestion?: { question: string; options: string[] };
};

function artifactIsReady(project: AppProjectDetail, artifactId: string | null) {
  if (!artifactId) return false;
  const artifact = project.artifacts.find((item) => item.id === artifactId);
  return artifact?.status === 'READY';
}

function isUnansweredPlanQuestion(
  messages: AppAgentMessage[],
  messageId: string,
) {
  const messageIndex = messages.findIndex(
    (message) => message.id === messageId,
  );
  if (messageIndex < 0) return false;

  const message = messages[messageIndex];
  if (!message?.metadata?.planQuestion) return false;

  return !messages.slice(messageIndex + 1).some((item) => item.role === 'user');
}

function shouldAutoRunInitialReply(
  messages: AppAgentMessage[],
  project: AppProjectDetail,
  artifactSlug: string | null,
  artifactId: string | null,
) {
  const lastMessage = messages.at(-1);
  if (!lastMessage || lastMessage.role !== 'user') return false;

  const hasAssistantAfterLastUser = messages.some(
    (message, index) =>
      index > messages.findIndex((item) => item.id === lastMessage.id) &&
      message.role === 'assistant',
  );
  if (hasAssistantAfterLastUser) return false;

  if (artifactSlug && artifactHasFiles(project.files, artifactSlug))
    return false;
  if (artifactIsReady(project, artifactId)) return false;

  return true;
}

export function AgentPanel({
  project,
  activeArtifactId,
  onPreviewVersionChange,
  onAgentRunComplete,
  onAgentActivityChange,
}: AgentPanelProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AppAgentMessage[]>(project.messages);
  const [expandedStepsFor, setExpandedStepsFor] = useState<string | null>(null);
  const [taskBoardOpen, setTaskBoardOpen] = useState(false);
  const [liveRun, setLiveRun] = useState<LiveRunState | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [planModeActive, setPlanModeActive] = useState(project.planMode);
  const initialReplyStarted = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastActivityKeyRef = useRef('');

  const activeArtifact =
    project.artifacts.find((artifact) => artifact.id === activeArtifactId) ??
    project.artifacts[0] ??
    null;

  const activeArtifactBuildable = activeArtifact
    ? artifactSupportsAgentBuild(activeArtifact.type)
    : false;

  useEffect(() => {
    setTimeout(() => {
      setPlanModeActive(project.planMode);
    }, 10);
  }, [project.planMode]);

  async function runAgentStream(options: {
    content?: string;
    initialReply?: boolean;
    optimisticUserMessage?: AppAgentMessage;
  }) {
    if (!activeArtifact || isStreaming) return;

    if (!artifactSupportsAgentBuild(activeArtifact.type)) return;

    if (options.optimisticUserMessage) {
      setMessages((current) => [...current, options.optimisticUserMessage!]);
    }

    setIsStreaming(true);
    setLiveRun({ working: true, actionCount: 0, steps: [], fileWrites: [] });

    let previewWrites = 0;
    let finalSteps: AgentStep[] = [];
    let finalFileWrites: AgentFileWriteSnapshot[] = [];

    try {
      await streamAgentRequest({
        projectId: project.id,
        artifactId: activeArtifact.id,
        content: options.content,
        conversationId: project.conversationId,
        initialReply: options.initialReply,
        onEvent: (event: AgentStreamEvent) => {
          if (event.type === 'status') {
            setLiveRun((current) =>
              current
                ? { ...current, working: true, actionCount: event.actionCount }
                : {
                    working: true,
                    actionCount: event.actionCount,
                    steps: [],
                    fileWrites: [],
                  },
            );
          }

          if (event.type === 'file_write') {
            finalFileWrites = (() => {
              const existingIndex = finalFileWrites.findIndex(
                (file) => file.path === event.path,
              );
              const snapshot: AgentFileWriteSnapshot = {
                path: event.path,
                content: normalizeFileContent(event.content),
                language: event.language,
                status: event.status,
              };
              if (existingIndex >= 0) {
                return finalFileWrites.map((file, index) =>
                  index === existingIndex ? snapshot : file,
                );
              }
              return [...finalFileWrites, snapshot];
            })();

            if (event.status === 'done') {
              previewWrites += 1;
              onPreviewVersionChange(1);
            }

            setLiveRun((current) =>
              current
                ? { ...current, fileWrites: finalFileWrites }
                : {
                    working: true,
                    actionCount: 0,
                    steps: [],
                    fileWrites: finalFileWrites,
                  },
            );
          }

          if (event.type === 'action') {
            const incoming: AgentStep = {
              type: 'action',
              label: event.label,
              path: event.path,
              status: event.status ?? 'done',
            };

            if (event.status === 'running') {
              finalSteps = [...finalSteps, incoming];
            } else {
              const runningIndex = [...finalSteps]
                .reverse()
                .findIndex(
                  (step) => step.type === 'action' && step.status === 'running',
                );
              if (runningIndex >= 0) {
                const index = finalSteps.length - 1 - runningIndex;
                finalSteps = finalSteps.map((step, i) =>
                  i === index
                    ? {
                        type: 'action' as const,
                        label: event.label,
                        path: event.path,
                        status: 'done' as const,
                      }
                    : step,
                );
              } else {
                finalSteps = [...finalSteps, incoming];
              }
            }

            setLiveRun((current) =>
              current
                ? {
                    ...current,
                    actionCount: finalSteps.length,
                    steps: finalSteps,
                  }
                : {
                    working: true,
                    actionCount: finalSteps.length,
                    steps: finalSteps,
                    fileWrites: finalFileWrites,
                  },
            );
          }

          if (event.type === 'plan_question') {
            setLiveRun((current) =>
              current
                ? {
                    ...current,
                    summary: event.question,
                    planQuestion: {
                      question: event.question,
                      options: event.options,
                    },
                  }
                : {
                    working: true,
                    actionCount: 0,
                    steps: [],
                    fileWrites: [],
                    summary: event.question,
                    planQuestion: {
                      question: event.question,
                      options: event.options,
                    },
                  },
            );
          }

          if (event.type === 'plan_completed') {
            setPlanModeActive(false);
          }

          if (event.type === 'text' || event.type === 'text_delta') {
            setLiveRun((current) =>
              current ? { ...current, summary: event.content } : null,
            );
          }

          if (event.type === 'done') {
            if (event.messageId) {
              setMessages((current) => [
                ...current,
                {
                  id: event.messageId,
                  role: 'assistant',
                  content: event.summary,
                  createdAt: new Date().toISOString(),
                  metadata: {
                    steps: event.steps,
                    fileWrites: event.fileWrites,
                    presentedArtifactId: event.presentedArtifactId,
                    previewVersion: event.previewVersion,
                    buildValid: event.buildValid,
                    planQuestion: event.planQuestion,
                    planCompleted: event.planCompleted,
                  },
                },
              ]);
            }

            if (event.planCompleted) {
              setPlanModeActive(false);
            }

            finalSteps = event.steps;
            finalFileWrites = dedupeFileWrites(
              event.fileWrites ?? finalFileWrites,
            );

            const remainingPreviewUpdates =
              event.previewVersion - previewWrites;
            if (remainingPreviewUpdates > 0) {
              onPreviewVersionChange(remainingPreviewUpdates);
            }

            if (event.buildValid && event.presentedArtifactId) {
              onAgentRunComplete?.({
                artifactId: event.presentedArtifactId,
                buildValid: true,
                previewVersion: event.previewVersion,
              });
            }
          }

          if (event.type === 'error') {
            setMessages((current) => [
              ...current,
              {
                id: `error-${Date.now()}`,
                role: 'assistant',
                content: `Sorry — I couldn't reach the agent right now. ${event.message}`,
                createdAt: new Date().toISOString(),
              },
            ]);
          }
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent failed.';
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `Sorry — I couldn't reach the agent right now. ${message}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLiveRun(null);
      setIsStreaming(false);
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [
    messages,
    liveRun?.steps.length,
    liveRun?.fileWrites.length,
    liveRun?.summary,
  ]);

  useEffect(() => {
    if (initialReplyStarted.current || !activeArtifact) return;

    if (
      !shouldAutoRunInitialReply(
        messages,
        project,
        activeArtifact.slug,
        activeArtifact.id,
      ) ||
      !artifactSupportsAgentBuild(activeArtifact.type)
    ) {
      return;
    }

    initialReplyStarted.current = true;
    setTimeout(() => {
      void runAgentStream({ initialReply: true });
    }, 10);
  }, [activeArtifact, messages, project]);

  function handleSend(content?: string) {
    const trimmed = (content ?? input).trim();
    if (!trimmed || isStreaming || !activeArtifact) return;

    if (!content) {
      setInput('');
    }

    const optimisticUserMessage: AppAgentMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    void runAgentStream({
      content: trimmed,
      optimisticUserMessage,
    });
  }

  function handlePlanOptionSelect(option: string) {
    handleSend(option);
  }

  const liveNonFileSteps = useMemo(
    () => getNonFileSteps(liveRun?.steps ?? [], liveRun?.fileWrites ?? []),
    [liveRun?.steps, liveRun?.fileWrites],
  );

  const liveActivityLabel = useMemo(() => {
    if (!liveRun?.working) return null;

    const streamingFile = liveRun.fileWrites.find(
      (file) => file.status === 'streaming',
    );
    if (streamingFile) {
      return `Writing ${fileNameFromAgentPath(streamingFile.path)}`;
    }

    const runningStep = liveNonFileSteps.find(
      (step) => step.type === 'action' && step.status === 'running',
    );
    if (runningStep?.type === 'action') {
      return runningStep.label;
    }

    if (
      liveRun.summary &&
      liveRun.fileWrites.length === 0 &&
      liveNonFileSteps.length === 0
    ) {
      return 'Thinking…';
    }

    return 'Working on your project…';
  }, [liveNonFileSteps, liveRun]);

  const buildStatusLabel = useMemo(() => {
    if (isStreaming) return null;

    const lastAssistant = messages
      .filter((message) => message.role === 'assistant')
      .at(-1);
    if (!lastAssistant?.metadata?.buildValid) return null;

    return 'Build complete';
  }, [isStreaming, messages]);

  const liveStreamingFileCount =
    liveRun?.fileWrites.filter((file) => file.status === 'streaming').length ??
    0;

  useEffect(() => {
    if (!onAgentActivityChange) return;

    if (!isStreaming || !activeArtifact) {
      if (lastActivityKeyRef.current !== 'idle') {
        lastActivityKeyRef.current = 'idle';
        onAgentActivityChange(idleAgentActivity);
      }
      return;
    }

    const streamingFile = [...(liveRun?.fileWrites ?? [])]
      .reverse()
      .find((file) => file.status === 'streaming');
    const runningStep = [...(liveRun?.steps ?? [])]
      .reverse()
      .find((step) => step.type === 'action' && step.status === 'running');

    const activeFilePath =
      streamingFile?.path ??
      (runningStep?.type === 'action' ? (runningStep.path ?? null) : null);
    const activeAction =
      runningStep?.type === 'action'
        ? runningStep.label
        : streamingFile
          ? `Writing ${streamingFile.path.split('/').pop() ?? streamingFile.path}`
          : 'Working…';

    const activityKey = `${activeArtifact.id}:${activeFilePath ?? ''}:${activeAction}`;
    if (lastActivityKeyRef.current === activityKey) return;

    lastActivityKeyRef.current = activityKey;
    onAgentActivityChange({
      isWorking: true,
      artifactId: activeArtifact.id,
      activeFilePath,
      activeAction,
    });
  }, [
    activeArtifact,
    isStreaming,
    liveRun?.steps,
    liveRun?.fileWrites,
    liveStreamingFileCount,
    onAgentActivityChange,
  ]);

  return (
    <section className="relative flex h-full min-w-0 flex-[0.95] flex-col border-r border-app-border-subtle bg-app-bg xl:max-w-[440px]">
      <div className="flex items-center justify-between border-b border-app-border-subtle px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-app-text">Agent</h2>
          <p className="text-xs text-app-text-muted">Build with conversation</p>
          {isStreaming && liveActivityLabel ? (
            <div className="mt-2">
              <AgentWorkingBadge label={liveActivityLabel} />
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTaskBoardOpen((value) => !value)}
            className="text-xs text-app-text-muted transition-colors hover:text-app-text-secondary">
            Agent task board
          </button>
          <Badge variant="orange" theme="app">
            Agent 4
          </Badge>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-app-border bg-app-surface/50 px-4 py-6 text-center">
            <p className="text-sm text-app-text-secondary">
              {project.description ?? `Start building ${project.name}.`}
            </p>
          </div>
        ) : null}

        {messages.map((message) => {
          const steps = message.metadata?.steps ?? [];
          const fileWrites = dedupeFileWrites(
            message.metadata?.fileWrites ?? [],
          );
          const displaySteps = getNonFileSteps(steps, fileWrites);
          const isBuildMessage =
            message.role === 'assistant' &&
            (fileWrites.length > 0 || displaySteps.length > 0);

          return (
            <div
              key={message.id}
              className={cn(
                'flex flex-col',
                message.role === 'user' ? 'items-end pl-6' : 'items-start pr-6',
              )}>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
                {message.role === 'user' ? 'You' : 'Agent'}
              </p>

              {message.role === 'assistant' ? (
                <>
                  <div className="max-w-full rounded-2xl rounded-tl-md border border-app-border-subtle bg-app-surface-active px-4 py-3">
                    <AgentMessageContent content={message.content} />
                  </div>

                  {message.metadata?.planQuestion ? (
                    <AgentPlanQuestion
                      options={message.metadata.planQuestion.options}
                      onSelect={handlePlanOptionSelect}
                      disabled={
                        isStreaming ||
                        !isUnansweredPlanQuestion(messages, message.id)
                      }
                      className="mt-2 w-full max-w-full"
                    />
                  ) : null}

                  {displaySteps.length > 0 ? (
                    <AgentActionSteps
                      steps={displaySteps}
                      expanded={
                        isBuildMessage || expandedStepsFor === message.id
                      }
                      onToggle={
                        isBuildMessage
                          ? undefined
                          : () =>
                              setExpandedStepsFor((current) =>
                                current === message.id ? null : message.id,
                              )
                      }
                      className="mt-2"
                    />
                  ) : null}

                  {fileWrites.length > 0 ? (
                    <AgentFileWriteStream
                      fileWrites={fileWrites}
                      className="mt-2 w-full max-w-full"
                    />
                  ) : null}
                </>
              ) : (
                <div className="max-w-full rounded-2xl rounded-tr-md border border-app-border bg-app-surface px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-app-text">
                  {message.content}
                </div>
              )}
            </div>
          );
        })}

        {liveRun?.working ? (
          <div className="flex flex-col items-start pr-6">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
              Agent
            </p>

            {liveRun.summary ? (
              <div className="mb-2 max-w-full rounded-2xl rounded-tl-md border border-app-border-subtle bg-app-surface-active px-4 py-3">
                <AgentMessageContent content={liveRun.summary} />
              </div>
            ) : null}

            {liveNonFileSteps.length > 0 ? (
              <AgentActionSteps
                steps={liveNonFileSteps}
                live
                expanded
                className="mb-2 w-full max-w-full"
              />
            ) : null}

            {liveRun.fileWrites.length > 0 ? (
              <AgentFileWriteStream
                fileWrites={liveRun.fileWrites}
                live
                className="mb-2 w-full max-w-full"
              />
            ) : null}

            {!liveRun.summary &&
            liveRun.steps.length === 0 &&
            liveRun.fileWrites.length === 0 ? (
              <WorkingIndicator actionCount={liveRun.actionCount} />
            ) : null}

            {liveRun.planQuestion ? (
              <AgentPlanQuestion
                options={liveRun.planQuestion.options}
                onSelect={handlePlanOptionSelect}
                disabled={isStreaming}
                className="w-full max-w-full"
              />
            ) : null}
          </div>
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-app-border-subtle bg-app-sidebar-bg/40 p-4">
        {project.artifacts.length > 1 && activeArtifact ? (
          <p className="mb-2 text-xs text-app-text-muted">
            Building in{' '}
            <span className="font-medium text-app-text-secondary">
              {activeArtifact.name}
            </span>
          </p>
        ) : null}
        {!activeArtifactBuildable && activeArtifact && !planModeActive ? (
          <p className="mb-2 rounded-lg border border-app-border-subtle bg-app-surface/60 px-3 py-2 text-xs leading-relaxed text-app-text-muted">
            {artifactTypeLabels[activeArtifact.type]} is not supported yet.
            Switch to Web app or Mobile app to build with Agent.
          </p>
        ) : null}
        {planModeActive ? (
          <p className="mb-2 text-xs text-app-text-muted">
            Plan mode — Agent will ask quick questions, finalize a plan, then
            build automatically.
          </p>
        ) : null}
        <Textarea
          theme="app"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={
            !activeArtifactBuildable && !planModeActive
              ? 'Switch to a supported artifact to build...'
              : planModeActive
                ? 'Answer a question or add details...'
                : 'Make, test, iterate...'
          }
          rows={3}
          disabled={
            isStreaming ||
            !activeArtifact ||
            (!activeArtifactBuildable && !planModeActive)
          }
          className="min-h-[72px] resize-none"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-xs text-app-text-muted">
              {planModeActive ? 'Plan' : 'Economy'}
            </span>
            {buildStatusLabel ? (
              <p className="mt-0.5 text-xs font-medium text-emerald-400">
                {buildStatusLabel}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={
              !input.trim() ||
              isStreaming ||
              !activeArtifact ||
              (!activeArtifactBuildable && !planModeActive)
            }
            className="rounded-lg bg-replit-orange px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
            {isStreaming ? 'Working...' : 'Send'}
          </button>
        </div>
      </div>

      <TaskBoardDrawer
        open={taskBoardOpen}
        onClose={() => setTaskBoardOpen(false)}
        steps={
          (liveRun?.steps ??
            messages.at(-1)?.metadata?.steps ??
            []) as AgentStep[]
        }
      />
    </section>
  );
}
