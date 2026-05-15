import type { Dot, PeerState, RowState, WriterSummary } from "./types.js";

export function observeDot(summary: WriterSummary, dot: Dot): void {
  summary[dot.peerId] = Math.max(summary[dot.peerId] ?? 0, dot.counter);
}

export function observeRow(summary: WriterSummary, row: RowState): void {
  if (row.tombstone) observeDot(summary, row.tombstone.dot);
  for (const cell of Object.values(row.cells)) observeDot(summary, cell.dot);
}

export function maxObservedCounter(summary: WriterSummary): number {
  return Math.max(0, ...Object.values(summary));
}

export function nextDot(peer: PeerState): Dot {
  peer.clock = Math.max(peer.clock, maxObservedCounter(peer.writerSummary)) + 1;
  const dot = { peerId: peer.peerId, counter: peer.clock };
  observeDot(peer.writerSummary, dot);
  return dot;
}

export function observePeerState(peer: PeerState): void {
  for (const table of Object.values(peer.tables)) {
    for (const row of Object.values(table.rows)) observeRow(peer.writerSummary, row);
  }
  peer.clock = Math.max(peer.clock, maxObservedCounter(peer.writerSummary));
}

export function compactMetadata(peer: PeerState): void {
  const compacted: WriterSummary = {};
  for (const table of Object.values(peer.tables)) {
    for (const row of Object.values(table.rows)) observeRow(compacted, row);
  }
  peer.writerSummary = compacted;
  observePeerState(peer);
}
