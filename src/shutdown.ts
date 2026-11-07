/** Saves the preferences, then closes the hosts; a failing save or close loses no other save. */
export async function shutdown(
  saves: readonly { flush(): Promise<void> }[],
  close: () => Promise<void>,
) {
  try {
    await Promise.all(saves.map((save) => save.flush()));
  } finally {
    await close();
  }
}
