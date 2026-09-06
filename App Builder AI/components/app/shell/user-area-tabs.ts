import {
  AccountIcon,
  BillingIcon,
  SettingsIcon,
  TrashIcon,
} from './user-area-icons';

export const userAreaTabs = [
  { label: 'Account', href: '/app/account', icon: AccountIcon },
  { label: 'Settings', href: '/app/settings', icon: SettingsIcon },
  { label: 'Billing', href: '/app/billing', icon: BillingIcon },
  { label: 'Trash', href: '/app/trash', icon: TrashIcon },
] as const;
