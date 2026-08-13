import { describe, expect, it } from "vitest";
import {
  attendeeCreatePayload,
  extractTranscriptFromUnknown,
  isReusableAttendeeBot,
  joinMeetingBot,
  mapAttendeeBotStatus,
  MeetingBotInUseError,
  meetingBotOwnerFromCookie,
  meetingDedupKey,
} from "./index.js";

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

  it("does not wrap OpenAI Speaker A lines as Speaker: Speaker A:", () => {
    expect(
      extractTranscriptFromUnknown([
        { speaker: "Speaker", transcription: { transcript: "Speaker A: we dial on the fly." } },
      ]),
    ).toBe("Speaker A: we dial on the fly.");
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

  it("does not force Meet caption language (avoids ui_element_not_found)", () => {
    const body = attendeeCreatePayload("https://meet.google.com/abc-defg-hij", "CallIQ Bot");
    const captions = (body.transcription_settings as { meeting_closed_captions: Record<string, unknown> })
      .meeting_closed_captions;
    expect(captions.google_meet_language).toBeUndefined();
    expect(body.google_meet_settings).toBeUndefined();
  });

  it("keeps a waiting-room bot and treats a 45s+ joining bot as stuck", () => {
    expect(
      isReusableAttendeeBot({ id: "a", state: "waiting_room", join_at: new Date().toISOString() }),
    ).toBe(true);
    expect(
      isReusableAttendeeBot({
        id: "b",
        state: "joining",
        join_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).toBe(false);
    expect(
      isReusableAttendeeBot({
        id: "c",
        state: "joining",
        join_at: new Date().toISOString(),
      }),
    ).toBe(true);
  });

  it("uses one dedup key per Meet so a second Send Bot does not spawn another guest", () => {
    expect(meetingDedupKey("https://meet.google.com/abc-defg-hij?authuser=0")).toBe(
      "calliq-meet-abc-defg-hij",
    );
    const body = attendeeCreatePayload("https://meet.google.com/abc-defg-hij", "CallIQ Bot");
    expect(body.deduplication_key).toBe("calliq-meet-abc-defg-hij");
  });

  it("explains ui_element_not_found instead of echoing the raw code", () => {
    const mapped = mapAttendeeBotStatus({
      state: "fatal_error",
      events: [{ type: "fatal_error", sub_type: "ui_element_not_found" }],
    });
    expect(mapped.status).toBe("failed");
    expect(mapped.error).toMatch(/admit CallIQ Bot/i);
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

describe("one bot, one transcript owner", () => {
  it("rejects a second join for the same Meet without handing over the transcript", async () => {
    const meet = `https://meet.google.com/own-${Date.now().toString(36)}-aaa`;
    const owner = await joinMeetingBot({ meetingUrl: meet, prefer: "simulated", demo: true });
    await expect(joinMeetingBot({ meetingUrl: meet, prefer: "simulated", demo: true })).rejects.toBeInstanceOf(
      MeetingBotInUseError,
    );
    const again = await joinMeetingBot({
      meetingUrl: meet,
      prefer: "simulated",
      demo: true,
      ownerSessionId: owner.id,
    });
    expect(again.id).toBe(owner.id);
  });

  it("reads only a well-formed owner cookie", () => {
    expect(meetingBotOwnerFromCookie(`other=1; calliq_bot=${"ogbot_abc_def"}`)).toBe("ogbot_abc_def");
    expect(meetingBotOwnerFromCookie("calliq_bot=../secret")).toBeUndefined();
  });
});
