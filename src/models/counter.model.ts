import { Schema, model, type Document, type ClientSession } from 'mongoose';

// The generic pins the _id type — this collection is keyed by a name
// ("order"), not an ObjectId.
export interface ICounter extends Document<string> {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const Counter = model<ICounter>('Counter', counterSchema);

/**
 * Produces the next human-facing order number: `SV-26-000184`.
 *
 * `findOneAndUpdate` with `$inc` is atomic, so two orders placed in the same
 * millisecond cannot receive the same number. Runs inside the placement
 * transaction, so an aborted order does not burn a sequence value.
 */
export async function nextOrderNo(
  session?: ClientSession,
  prefix = 'SV',
): Promise<string> {
  const doc = await Counter.findOneAndUpdate(
    { _id: 'order' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session: session ?? undefined },
  );

  const year = String(new Date().getFullYear()).slice(-2);
  const seq = String(doc.seq).padStart(6, '0');
  return `${prefix}-${year}-${seq}`;
}
