export const PROJECT_ANIMALS = [
  { id: "hamster", label: "仓鼠", emoji: "🐹" },
  { id: "sloth", label: "树懒", emoji: "🦥" },
  { id: "fox", label: "狐狸", emoji: "🦊" },
  { id: "owl", label: "猫头鹰", emoji: "🦉" },
  { id: "penguin", label: "企鹅", emoji: "🐧" },
  { id: "cat", label: "猫", emoji: "🐈" }
] as const;

export type ProjectAnimalId = typeof PROJECT_ANIMALS[number]["id"];

export function isProjectAnimalId(value: string): value is ProjectAnimalId {
  return PROJECT_ANIMALS.some((animal) => animal.id === value);
}

export function projectAnimalEmoji(value?: string): string {
  return PROJECT_ANIMALS.find((animal) => animal.id === value)?.emoji ?? "";
}
