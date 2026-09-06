export type AppUserSettings = {
  defaultStartPage: 'HOME' | 'PROJECTS';
  showShortcuts: boolean;
  workspaceSlug: string;
};

export const defaultStartPageOptions = [
  { value: 'HOME' as const, label: 'Home' },
  { value: 'PROJECTS' as const, label: 'Projects' },
];
