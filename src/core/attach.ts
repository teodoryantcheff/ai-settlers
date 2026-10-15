export function attachSubsystem<T extends object>(game: object, subsystem: T): T {
  for (const key of Object.keys(subsystem)) {
    if (Object.hasOwn(game, key)) throw new Error(`Duplicate runtime binding: ${key}`);
  }
  Object.defineProperties(game, Object.getOwnPropertyDescriptors(subsystem));
  return subsystem;
}
