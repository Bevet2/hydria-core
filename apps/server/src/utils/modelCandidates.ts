export function parseModelCandidates(...inputs: Array<string | null | undefined>) {
  const values = inputs.flatMap((input) =>
    (input ?? "")
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean)
  );

  return values.filter((value, index) => values.indexOf(value) === index);
}
