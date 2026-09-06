export type PreviewDeviceId =
  | 'full'
  | 'iphone-17-pro'
  | 'iphone-17-pro-max'
  | 'galaxy-s25'
  | 'galaxy-s25-plus'
  | 'ipad-mini';

export type PreviewDevicePreset = {
  id: PreviewDeviceId;
  label: string;
  /** CSS viewport width in logical pixels */
  width: number | null;
  /** CSS viewport height in logical pixels */
  height: number | null;
  /** Screen corner radius in CSS px at 1:1 scale (matches hardware display rounding) */
  radius: number;
  /** Hide scrollbars inside the device frame while keeping scroll enabled */
  hideScrollbars: boolean;
};

export const PREVIEW_DEVICE_PRESETS: PreviewDevicePreset[] = [
  {
    id: 'full',
    label: 'Full size',
    width: null,
    height: null,
    radius: 0,
    hideScrollbars: false,
  },
  {
    id: 'iphone-17-pro',
    label: 'iPhone 17 Pro',
    width: 402,
    height: 874,
    radius: 55,
    hideScrollbars: true,
  },
  {
    id: 'iphone-17-pro-max',
    label: 'iPhone 17 Pro Max',
    width: 440,
    height: 956,
    radius: 60,
    hideScrollbars: true,
  },
  {
    id: 'galaxy-s25',
    label: 'Samsung Galaxy S25',
    width: 360,
    height: 780,
    radius: 32,
    hideScrollbars: true,
  },
  {
    id: 'galaxy-s25-plus',
    label: 'Samsung Galaxy S25+',
    width: 412,
    height: 891,
    radius: 36,
    hideScrollbars: true,
  },
  {
    id: 'ipad-mini',
    label: 'iPad Mini',
    width: 744,
    height: 1133,
    radius: 18,
    hideScrollbars: true,
  },
];

export function getPreviewDevicePreset(id: PreviewDeviceId) {
  return (
    PREVIEW_DEVICE_PRESETS.find((preset) => preset.id === id) ??
    PREVIEW_DEVICE_PRESETS[0]
  );
}

export function isPreviewDeviceId(value: string): value is PreviewDeviceId {
  return PREVIEW_DEVICE_PRESETS.some((preset) => preset.id === value);
}

export function isDeviceFramedPreview(id: PreviewDeviceId) {
  return id !== 'full';
}

export function previewDeviceStorageKey(projectId: string) {
  return `replit-clone:preview-device:${projectId}`;
}
