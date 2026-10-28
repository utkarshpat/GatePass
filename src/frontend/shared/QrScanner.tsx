import { useEffect, useRef, useState } from "react";
import { Dialog } from "./controls.tsx";
type Library = {
  BrowserQRCodeReader: new () => {
    reset: () => void;
    decodeFromStream: (
      stream: MediaStream,
      video: HTMLVideoElement,
      callback: (result: { getText: () => string } | null) => void,
    ) => Promise<void>;
  };
};
const loads = new Map<string, Promise<Library>>();
export function loadQrLibrary(url: string): Promise<Library> {
  if (window.ZXing?.BrowserQRCodeReader) return Promise.resolve(window.ZXing);
  const cached = loads.get(url);
  if (cached) return cached;
  const promise = new Promise<Library>((resolve, reject) => {
    const script = document.createElement("script");
    script.nonce =
      (document.getElementById("app-config") as HTMLScriptElement | null)
        ?.nonce ?? "";
    script.src = url;
    script.async = true;
    const fail = () => {
        window.clearTimeout(timer);
        script.onload = script.onerror = null;
        script.remove();
        loads.delete(url);
        reject(Error("QR decoder unavailable. Retry or search by pass ID."));
      },
      timer = window.setTimeout(fail, 15000);
    script.onerror = fail;
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.ZXing?.BrowserQRCodeReader) resolve(window.ZXing);
      else fail();
    };
    document.head.append(script);
  });
  loads.set(url, promise);
  return promise;
}
export function QrScanner({
  open,
  onClose,
  onCredential,
  url,
  id = "lookup-scanner",
}: {
  open: boolean;
  onClose: () => void;
  onCredential: (value: string) => void;
  url: string;
  id?: string;
}) {
  const video = useRef<HTMLVideoElement>(null),
    latest = useRef({ onClose, onCredential }),
    [message, setMessage] = useState("");
  latest.current = { onClose, onCredential };
  useEffect(() => {
    if (!open) return;
    let active = true,
      stream: MediaStream | null = null,
      reader: InstanceType<Library["BrowserQRCodeReader"]> | null = null;
    const stop = () => {
        active = false;
        reader?.reset();
        for (const track of stream?.getTracks() ?? []) track.stop();
        if (video.current) video.current.srcObject = null;
      },
      hide = () => {
        stop();
        latest.current.onClose();
      };
    window.addEventListener("pagehide", hide);
    const visible = () => {
      if (document.hidden) hide();
    };
    document.addEventListener("visibilitychange", visible);
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMessage(
          "Camera unavailable. Search by pass ID, name or mobile instead.",
        );
        return;
      }
      setMessage("Opening camera…");
      try {
        const library = await loadQrLibrary(url);
        if (!active) return;
        reader = new library.BrowserQRCodeReader();
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
          },
          audio: false,
        });
        if (!active) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        const node = video.current;
        if (!node) {
          stop();
          return;
        }
        node.srcObject = stream;
        setMessage("Keep the pass QR inside the camera view.");
        await reader.decodeFromStream(stream, node, (result) => {
          if (!result || !active) return;
          const value = result.getText();
          if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) {
            setMessage(
              "This is not a GatePass pass QR. Scan the printed pass QR.",
            );
            return;
          }
          stop();
          latest.current.onClose();
          latest.current.onCredential(value);
        });
        if (!active) reader.reset();
      } catch {
        if (active) {
          reader?.reset();
          for (const track of stream?.getTracks() ?? []) track.stop();
          setMessage(
            "Camera could not start. Allow camera access or search by pass ID.",
          );
        }
      }
    })();
    return () => {
      stop();
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [open, url]);
  return (
    <Dialog
      id={id}
      className="modal app-dialog"
      aria-labelledby={id + "-title"}
      open={open}
      onDismiss={onClose}
    >
      <div className="modal-header">
        <h2 id={id + "-title"}>Scan pass QR</h2>
        <button
          className="close"
          type="button"
          id="lookup-scan-close"
          aria-label="Close scanner"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="modal-body">
        <video ref={video} id="lookup-video" autoPlay muted playsInline />
        <p id="lookup-camera-status" role="status">
          {message}
        </p>
      </div>
    </Dialog>
  );
}
