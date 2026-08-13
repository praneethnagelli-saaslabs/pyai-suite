import { useRef } from "react";
import { Button } from "@/components/ui";
import { RECORDING_ACCEPT, validateRecordingFile } from "@/lib/audio";

export function RecordingUploadButton({
  disabled,
  busy,
  label = "Upload recording",
  busyLabel = "Transcribing…",
  variant = "ghost",
  size = "md",
  onFile,
  onInvalid,
}: {
  disabled?: boolean;
  busy?: boolean;
  label?: string;
  busyLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  onFile: (file: File) => void | Promise<void>;
  onInvalid?: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={RECORDING_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const err = validateRecordingFile(file);
          if (err) {
            onInvalid?.(err);
            return;
          }
          void onFile(file);
        }}
      />
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? busyLabel : label}
      </Button>
    </>
  );
}
