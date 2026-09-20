export function createLatestRequestGuard() {
  let sequence = 0;
  return {
    begin(): number {
      sequence += 1;
      return sequence;
    },
    isCurrent(request: number): boolean {
      return request === sequence;
    },
    invalidate(): void {
      sequence += 1;
    },
  };
}
