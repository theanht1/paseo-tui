export function confirmQuit(deadline: number | null, now: number) {
  return { quit: deadline !== null && now < deadline, deadline: now + 2000 };
}
