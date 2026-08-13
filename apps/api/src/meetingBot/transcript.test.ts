import { describe, expect, it } from "vitest";
import { extractTranscriptFromUnknown } from "./index.js";

describe("extractTranscriptFromUnknown", () => {
  it("parses Attendee utterance shape", () => {
    const raw = [
      {
        speaker_name: "Nagelli Praneeth",
        transcription: { transcript: "But." },
      },
      {
        speaker_name: "CallIQ Bot",
        transcription: { transcript: "Hello team." },
      },
    ];
    expect(extractTranscriptFromUnknown(raw)).toBe(
      "Nagelli Praneeth: But.\nCallIQ Bot: Hello team.",
    );
  });

  it("returns undefined for empty Attendee transcript", () => {
    expect(extractTranscriptFromUnknown([])).toBeUndefined();
  });
});
