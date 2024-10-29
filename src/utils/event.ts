import { Event } from "../types/blockchain";

export function formatEventId(event: Event): string {
  return `${event.transactionHash}_${event.logIndex}`;
}

export function createEventId(transactionHash: string, logIndex: number): string {
  return `${transactionHash}_${logIndex}`;
}
