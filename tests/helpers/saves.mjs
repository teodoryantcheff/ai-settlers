import { unpackSaveHistories } from '../../src/core/save-codec.ts';

/**
 * Parse save text into its plain form, with every packed sample history expanded to
 * an array of samples. Tests edit this form to build corrupt or older saves; the
 * loader accepts it exactly as it accepts saves written before histories were packed.
 */
export function plainSave(text) {
  const data = JSON.parse(text);
  unpackSaveHistories(data, (message) => {
    throw new Error(message);
  });
  return data;
}
