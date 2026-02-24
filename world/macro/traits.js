export function speedMultiplierFromTraitCode(code) {
  switch (code) {
    case "S5":
      return 1.35;
    case "S4":
      return 1.18;
    case "S2":
      return 0.86;
    case "S1":
      return 0.72;
    case "S3":
    default:
      return 1.0;
  }
}

