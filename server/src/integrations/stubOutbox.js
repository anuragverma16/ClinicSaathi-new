/**
 * When a provider has no credentials, its sender logs instead of sending and
 * keeps the last few messages here. This lets the in-process test suite read
 * an OTP without any HTTP backdoor. Never populated when a real provider is set.
 */
const outbox = [];
const MAX = 100;

export function recordStub(entry) {
  outbox.push({ ...entry, at: new Date() });
  if (outbox.length > MAX) outbox.shift();
}

export const stubOutbox = () => outbox;
export const lastStubTo = (to) => [...outbox].reverse().find((m) => m.to === to);
