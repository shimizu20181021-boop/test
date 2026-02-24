export function isMacroNonAnimalKind(kind) {
  return kind === "plant" || kind === "meat" || kind === "egg" || kind === "nest" || kind === "rock" || kind === "tree";
}

export function isMacroObstacleKind(kind) {
  return kind === "rock" || kind === "tree";
}

