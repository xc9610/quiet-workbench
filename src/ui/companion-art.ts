export const CAPYBARA_ICON_ID = "asterism-capybara";
export const SLOTH_ICON_ID = "asterism-sloth";

export const CAPYBARA_ICON_SVG = `
  <path d="M4 13.2c0-4.1 3.2-7.1 7.7-7.1h2.1c3.8 0 6.2 2.5 6.2 6.2v2.4c0 2.5-2.1 4.5-4.6 4.5H9.1C6.2 19.2 4 17.1 4 14.4Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
  <path d="M7.5 7.1 7.1 4.5l2.6.9m6.8.8 1.8-2.1.9 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="9.3" cy="11.8" r=".9" fill="currentColor" />
  <circle cx="16.2" cy="11.8" r=".9" fill="currentColor" />
  <path d="M11.2 15.2c1.1.9 2.5.9 3.6 0m-2.5-1.5h1.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
`;

export const SLOTH_ICON_SVG = `
  <path d="M3.6 4.9h16.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
  <path d="M8.1 5.1c-.4 2.3-1.5 3.2-1.5 6.5 0 4.5 2.4 8 5.4 8s5.4-3.5 5.4-8c0-3.3-1.1-4.2-1.5-6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
  <path d="M8.2 11.2c1.7-2 5.9-2.5 7.6 0 1.5 2.2.2 5.7-3.8 5.7s-5.3-3.5-3.8-5.7Z" fill="none" stroke="currentColor" stroke-width="1.5" />
  <path d="m8.7 11.9 2.2 1.5m4.4-1.5-2.2 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
  <path d="M11.3 15.5c.5.4.9.5 1.4 0" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
`;

export function companionIconName(companionName: string): string {
  if (companionName === "卡皮") return CAPYBARA_ICON_ID;
  if (companionName === "慢慢") return SLOTH_ICON_ID;
  return "asterism-mark";
}
