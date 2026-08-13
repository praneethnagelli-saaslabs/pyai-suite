import { describe, expect, it } from "vitest";
import { extractTranscriptFromUnknown, mapAttendeeBotStatus } from "./index.js";

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

describe("mapAttendeeBotStatus", () => {
  it("keeps joined_recording as in_call even with live lines", () => {
    const mapped = mapAttendeeBotStatus({
      state: "joined_recording",
      transcriptText: "Nagelli: hello",
    });
    expect(mapped.status).toBe("in_call");
    expect(mapped.leftMeet).toBe(false);
  });

  it("stops recording as soon as the bot is leaving if transcript exists", () => {
    const mapped = mapAttendeeBotStatus({
      state: "leaving",
      transcriptText: "Nagelli: I am willing to sell you just call products",
    });
    expect(mapped.status).toBe("done");
    expect(mapped.leftMeet).toBe(true);
  });

  it("does not stay in_call during post_processing", () => {
    const mapped = mapAttendeeBotStatus({
      state: "post_processing",
      transcriptionState: "in_progress",
      transcriptText: "Rep: next steps tomorrow",
    });
    expect(mapped.status).toBe("done");
    expect(mapped.leftMeet).toBe(true);
  });

  it("waits for transcript after leave when none is ready yet", () => {
    const mapped = mapAttendeeBotStatus({
      state: "post_processing",
      transcriptionState: "in_progress",
    });
    expect(mapped.status).toBe("waiting_transcript");
    expect(mapped.leftMeet).toBe(true);
  });

  it("keeps waiting after ended until a transcript actually arrives", () => {
    const mapped = mapAttendeeBotStatus({
      state: "ended",
      transcriptionState: "complete",
    });
    expect(mapped.status).toBe("waiting_transcript");
    expect(mapped.leftMeet).toBe(true);
  });

  it("parses Attendee transcription as a plain string", () => {
    expect(
      extractTranscriptFromUnknown([
        { speaker_name: "Dana", transcription: "We can start next week." },
      ]),
    ).toBe("Dana: We can start next week.");
  });

  it("treats left_meeting events as leave even if state lags", () => {
    const mapped = mapAttendeeBotStatus({
      state: "joined_recording",
      events: [{ type: "left_meeting" }],
      transcriptText: "Speaker: bye",
    });
    expect(mapped.status).toBe("done");
    expect(mapped.leftMeet).toBe(true);
  });
});
