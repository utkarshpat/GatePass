import { parsePhoneNumberFromString } from "libphonenumber-js/mobile";
import type { PageConfig } from "../types.ts";
import { createStore, Resources, inspectForTests } from "../shared/model.ts";
import { photoCropSource } from "./photo.ts";
import type {
  Options,
  Employee,
  Person,
  Host,
  Extra,
  RequestBody,
  Job,
  Submitted,
  CardImage,
} from "./types.ts";
class Failure extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}
export type PhotoElements = {
  video: () => HTMLVideoElement | null;
  preview: () => HTMLImageElement | null;
  frame: () => HTMLElement | null;
};
export function createSelfServiceModel(
  config: PageConfig,
  elements: PhotoElements,
) {
  const resources = new Resources(),
    person = (): Person => ({
      key: crypto.randomUUID(),
      name: "",
      phone: "",
      phoneRaw: "",
      country: "IN",
      email: "",
      companyName: "",
      deviceTypes: [],
      file: null,
      url: null,
    }),
    state = {
      mode: null as "employee" | "visitor" | null,
      employee: null as Employee | null,
      options: null as Options | null,
      step: 0,
      accessEditor: false,
      host: null as Host | null,
      hosts: [] as Host[],
      extras: [] as Extra[],
      people: [person()],
      photoIndex: 0,
      jobs: null as Job[] | null,
      busy: false,
      initializing: false,
      searchVersion: 0,
      view: "landing",
      email: "",
      password: "",
      showPassword: false,
      reason: "",
      reasonDetails: "",
      projectId: "",
      validUntil: "",
      purpose: "",
      purposeDetails: "",
      hostQuery: "",
      hostFeedback: "",
      hostsOpen: false,
      cameraOpening: false,
      stream: null as MediaStream | null,
      focus: "",
      notices: [] as {
        id: number;
        message: string;
        kind: "error" | "success" | "info";
      }[],
    };
  const store = createStore({ ...state }),
    publish = () => {
      if (resources.alive) store.update({ ...state });
    };
  let flowVersion = 0,
    cameraVersion = 0,
    searchTimer: number | undefined,
    noticeId = 0,
    restoring = false;
  const cookie = (name: string) =>
      document.cookie
        .split("; ")
        .find((v) => v.startsWith(name + "="))
        ?.split("=")[1],
    steps = () =>
      state.mode === "employee"
        ? ["Details", "Photo", "Review"]
        : ["Details", "Visit", "Photo", "Review"],
    photoStep = () => steps().length - 2;
  function notify(message = "", kind: "error" | "success" | "info" = "info") {
    state.notices = message
      ? [...state.notices, { id: ++noticeId, message, kind }]
      : [];
    publish();
  }
  async function send<T>(
    path: string,
    body: unknown = {},
    binary = false,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": binary ? (body as Blob).type : "application/json",
    };
    if (config.manualReception) {
      if (!path.startsWith("/api/registration/"))
        throw Error("Employee authentication must use self-service.");
      path = path.replace("/api/registration/", "/api/reception/manual/");
      headers["X-Reception-Office"] = config.officeCode;
      headers["X-CSRF-Token"] = cookie("gp-staff-csrf") ?? "";
      headers["X-Intake-CSRF-Token"] = cookie("gp-reception-intake-csrf") ?? "";
    } else {
      if (cookie("gp-dev-csrf"))
        headers["X-CSRF-Token"] = cookie("gp-dev-csrf")!;
      if (cookie("gp-dev-intake-csrf"))
        headers["X-Intake-CSRF-Token"] = cookie("gp-dev-intake-csrf")!;
    }
    const controller = resources.controller(),
      timer = window.setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        signal: controller.signal,
        headers,
        body: binary ? (body as Blob) : JSON.stringify(body),
      });
      if (!response.ok)
        throw new Failure(
          (
            {
              400: "Check the details and try again.",
              401: "Sign in again to continue.",
              403: "Access unavailable for this request.",
              409: "Request changed. Refresh and try again.",
              429: "Too many requests. Please wait.",
            } as Record<number, string>
          )[response.status] ?? "Unable to complete the request. Please retry.",
          response.status,
        );
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Failure) throw error;
      throw new Failure(
        controller.signal.aborted
          ? "Request timed out. Please retry."
          : "Connection lost. Please retry.",
      );
    } finally {
      window.clearTimeout(timer);
      resources.release(controller);
    }
  }
  const auth = <T>(action: string, body: unknown = {}) =>
    send<T>("/api/dev/sso/" + action, body);
  function stopCamera() {
    cameraVersion++;
    for (const track of state.stream?.getTracks() ?? []) track.stop();
    state.stream = null;
    const video = elements.video();
    if (video) video.srcObject = null;
    publish();
  }
  const navigationState = () => ({
    gatepass: true,
    view: state.view,
    step: state.step,
    flow: flowVersion,
  });
  function rememberNavigation() {
    if (restoring) return;
    const next = navigationState(),
      current = history.state;
    if (
      current?.view === next.view &&
      current?.step === next.step &&
      current?.flow === next.flow
    )
      return;
    history.pushState(next, "");
  }
  function screen(view: string) {
    state.view = view;
    document.body.dataset.view = view;
    publish();
    rememberNavigation();
  }
  function busy(value: boolean, initializing = false) {
    state.busy = value;
    state.initializing = initializing;
    publish();
  }
  function closeAccessDialog() {
    state.accessEditor = false;
    resources.clearTimeout(searchTimer);
    state.searchVersion++;
    state.hostsOpen = false;
    publish();
  }
  function reset() {
    flowVersion++;
    stopCamera();
    resources.clearTimeout(searchTimer);
    state.searchVersion++;
    for (const job of state.jobs ?? [])
      if (job.cardUrl) URL.revokeObjectURL(job.cardUrl);
    for (const entry of state.people) {
      if (entry.url) URL.revokeObjectURL(entry.url);
      if (entry.croppedUrl) URL.revokeObjectURL(entry.croppedUrl);
    }
    state.options = null;
    state.step = 0;
    state.accessEditor = false;
    state.host = null;
    state.hosts = [];
    state.extras = [];
    state.people = [person()];
    state.photoIndex = 0;
    state.jobs = null;
    state.reason =
      state.reasonDetails =
      state.purpose =
      state.purposeDetails =
      state.projectId =
      state.validUntil =
      state.hostQuery =
      state.hostFeedback =
        "";
    state.hostsOpen = false;
    state.busy = state.initializing = false;
    publish();
  }
  function setEmployee(employee: Employee) {
    state.employee = employee;
    publish();
  }
  function renderProjects() {
    if (!state.options) return;
    const available = state.options.projects.filter(
      (p) =>
        !state.extras.some((x) => x.projectLocationId === p.projectLocationId),
    );
    if (!available.some((v) => v.projectLocationId === state.projectId))
      state.projectId =
        available.length === 1 ? available[0].projectLocationId : "";
    publish();
  }
  async function beginFlow(mode: "employee" | "visitor") {
    if (config.manualReception && mode !== "visitor")
      throw Error("Employee authentication must use self-service.");
    reset();
    state.mode = mode;
    const version = flowVersion;
    if (mode === "employee" && state.employee)
      state.people[0].name = state.employee.displayName;
    screen("flow");
    renderStep(0);
    busy(true, true);
    try {
      await send("/api/registration/reset");
      if (version !== flowVersion) return;
      await send("/api/registration/start", {
        requestType: mode === "employee" ? "DIGITAL_ID" : "EXTERNAL",
      });
      if (version !== flowVersion) return;
      const options = await send<Options>("/api/registration/options");
      if (version !== flowVersion || !resources.alive) return;
      state.options = options;
      if (options.locationCode !== config.officeCode)
        throw Error("Office changed. Reload this page.");
      state.validUntil = options.currentDate;
      renderProjects();
      if (mode === "employee" && !options.digitalIdEligible)
        notify("Select a account and local host to request access.");
    } catch (error) {
      if (version === flowVersion) {
        screen("landing");
        notify(
          error instanceof Error ? error.message : "Unable to start.",
          "error",
        );
      }
    } finally {
      if (version === flowVersion) busy(false);
    }
  }
  function renderStep(step: number) {
    closeAccessDialog();
    stopCamera();
    state.step = step;
    state.focus = "flow-title";
    notify();
    publish();
    rememberNavigation();
  }
  function validPhone(entry: Person) {
    if (!/^[+\d\s().-]+$/u.test(entry.phoneRaw) || entry.phoneRaw.length > 30)
      return null;
    const number = parsePhoneNumberFromString(entry.phoneRaw, {
      defaultCountry: entry.country,
      extract: false,
    });
    return number?.isValid() && number.country === entry.country && !number.ext
      ? number.number
      : null;
  }
  function validateDetails() {
    if (state.mode === "visitor") {
      const entry = state.people[0];
      entry.name = entry.name.trim();
      entry.email = entry.email.trim();
      entry.companyName = entry.companyName.trim();
      entry.phone = validPhone(entry) ?? "";
      if (!entry.name || !entry.phone) {
        notify("Enter a name and mobile number for each visitor.", "error");
        return false;
      }
      if (entry.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(entry.email))
        return false;
      return true;
    }
    if (!state.options?.digitalIdEligible && !state.extras.length) {
      notify("Add a account and local host for approval.", "error");
      state.focus = "toggle-access";
      publish();
      return false;
    }
    if (!state.reason) {
      notify("Select a reason.", "error");
      state.focus = "reason-trigger";
      publish();
      return false;
    }
    if (state.reason === "OTHER" && !state.reasonDetails.trim()) {
      notify("Add the reason.", "error");
      state.focus = "reason-details";
      publish();
      return false;
    }
    return true;
  }
  function purpose() {
    return (
      state.purpose +
      (state.purposeDetails.trim() ? " · " + state.purposeDetails.trim() : "")
    );
  }
  function validateVisit() {
    if (state.mode === "employee" && !state.projectId) {
      notify("Select a account.", "error");
      state.focus = "project-trigger";
      return false;
    }
    if (!state.host) {
      notify("Select a host from the search results.", "error");
      state.focus = "host-search";
      return false;
    }
    if (!state.purpose) {
      notify("Select a purpose.", "error");
      state.focus = "purpose-trigger";
      return false;
    }
    if (state.purpose === "Other" && !state.purposeDetails.trim()) {
      notify("Add the purpose.", "error");
      state.focus = "purpose-details";
      return false;
    }
    return (
      state.mode === "employee" ||
      (!!state.options &&
        state.validUntil >= state.options.currentDate &&
        state.validUntil <= state.options.maxVisitDate)
    );
  }
  function editAccess() {
    if (state.busy || state.jobs || !state.options) return;
    stopCamera();
    state.accessEditor = true;
    renderProjects();
    state.host = null;
    state.hostQuery = state.hostFeedback = "";
    state.hostsOpen = false;
    state.purpose = state.purposeDetails = "";
    state.focus = "project-trigger";
    publish();
  }
  async function searchHosts() {
    const version = ++state.searchVersion,
      query = state.hostQuery.trim(),
      project = state.projectId;
    state.host = null;
    state.hosts = [];
    state.hostsOpen = false;
    state.hostFeedback = "";
    publish();
    if (query.length < 2 || (state.mode === "employee" && !project)) return;
    try {
      const result = await send<{ hosts: Host[] }>(
        "/api/registration/options",
        {
          search: query,
          ...(state.mode === "employee" ? { projectLocationId: project } : {}),
        },
      );
      if (
        version !== state.searchVersion ||
        project !== state.projectId ||
        query !== state.hostQuery.trim() ||
        !resources.alive
      )
        return;
      state.hosts = result.hosts;
      state.hostsOpen = !!result.hosts.length;
      state.hostFeedback = result.hosts.length
        ? ""
        : "No matching hosts found.";
      publish();
    } catch (error) {
      if (version === state.searchVersion) {
        state.hostFeedback =
          error instanceof Error ? error.message : "Host search unavailable.";
        publish();
      }
    }
  }
  function applyPhotoTransform() {
    const entry = state.people[state.photoIndex],
      preview = elements.preview(),
      frame = elements.frame();
    if (!entry?.url || !preview) return;
    const pan = entry.pan ?? { x: 0, y: 0 },
      zoom = entry.zoom ?? 1;
    if (frame && preview.naturalWidth && preview.clientWidth) {
      const fit = Math.max(
          preview.clientWidth / preview.naturalWidth,
          preview.clientHeight / preview.naturalHeight,
        ),
        bounds = frame.getBoundingClientRect(),
        maxX = Math.max(
          0,
          (preview.naturalWidth * fit * zoom - bounds.width) / 2,
        ),
        maxY = Math.max(
          0,
          (preview.naturalHeight * fit * zoom - bounds.height) / 2,
        );
      pan.x = Math.min(maxX, Math.max(-maxX, pan.x));
      pan.y = Math.min(maxY, Math.max(-maxY, pan.y));
      entry.pan = pan;
    }
    preview.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) scaleX(${entry.flipped ? -1 : 1})`;
    publish();
  }
  async function commitPhotoCrop(entry = state.people[state.photoIndex]) {
    if (!entry?.url) throw Error("Add a photo first.");
    const frame = elements.frame(),
      preview = elements.preview(),
      source = entry.url;
    if (!frame || !preview || preview.hidden)
      throw Error("Photo preview unavailable.");
    const image = new Image();
    image.src = source;
    await image.decode();
    if (
      entry.url !== source ||
      state.people[state.photoIndex] !== entry ||
      !resources.alive
    )
      throw Error("Photo changed. Please retry.");
    applyPhotoTransform();
    const crop = photoCropSource(
        image.naturalWidth,
        image.naturalHeight,
        preview.getBoundingClientRect(),
        frame.getBoundingClientRect(),
        !!entry.flipped,
      ),
      canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 800;
    const context = canvas.getContext("2d");
    if (!context) throw Error("Photo editor unavailable.");
    if (entry.flipped) {
      context.translate(600, 0);
      context.scale(-1, 1);
    }
    context.drawImage(
      image,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      0,
      0,
      600,
      800,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob?.size) throw Error("Photo could not be saved. Please retry.");
    entry.file = new File([blob], "photo.jpg", { type: "image/jpeg" });
    if (entry.croppedUrl) URL.revokeObjectURL(entry.croppedUrl);
    entry.croppedUrl = URL.createObjectURL(blob);
    publish();
  }
  function useCapturedPhoto(file: File) {
    if (
      !file ||
      file.type !== "image/jpeg" ||
      !file.size ||
      file.size > 5242880
    ) {
      notify("Camera capture failed. Retake the photo.", "error");
      return;
    }
    const entry = state.people[state.photoIndex];
    if (entry.url) URL.revokeObjectURL(entry.url);
    entry.file = entry.rawFile = file;
    entry.flipped = false;
    entry.pan = { x: 0, y: 0 };
    entry.zoom = 1;
    entry.url = URL.createObjectURL(file);
    stopCamera();
    notify();
    publish();
  }
  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      notify("Camera unavailable. Use a device with camera access.", "error");
      return;
    }
    stopCamera();
    const version = cameraVersion;
    state.cameraOpening = true;
    publish();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 960 },
          height: { ideal: 1280 },
        },
        audio: false,
      });
      if (
        version !== cameraVersion ||
        state.step !== photoStep() ||
        state.view !== "flow" ||
        !resources.alive
      ) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      state.stream = stream;
      const video = elements.video();
      if (!video) {
        stopCamera();
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (state.stream !== stream) return;
      notify();
      publish();
    } catch {
      stopCamera();
      if (state.step === photoStep())
        notify(
          "Camera unavailable. Allow camera access and try again.",
          "error",
        );
    } finally {
      state.cameraOpening = false;
      publish();
    }
  }
  async function capture() {
    const video = elements.video(),
      entry = state.people[state.photoIndex],
      stream = state.stream;
    if (!stream || !video?.videoWidth) {
      notify("Camera is still starting.", "error");
      return;
    }
    const canvas = document.createElement("canvas"),
      scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d")!;
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88),
    );
    if (
      state.stream !== stream ||
      state.people[state.photoIndex] !== entry ||
      !resources.alive
    )
      return;
    if (blob)
      useCapturedPhoto(new File([blob], "photo.jpg", { type: "image/jpeg" }));
  }
  function prepareJobs() {
    const first: RequestBody = {
      requestType: state.mode === "employee" ? "DIGITAL_ID" : "EXTERNAL",
      clientKey: crypto.randomUUID(),
      reason:
        state.mode === "employee"
          ? state.reasonDetails.trim() ||
            (
              {
                FORGOT: "Forgot my card",
                LOST: "Lost my card",
                OTHER: "Other",
              } as Record<string, string>
            )[state.reason] ||
            state.reason
          : purpose(),
    };
    if (state.mode === "employee") first.digitalIdReason = state.reason;
    else {
      first.validUntilDate = state.validUntil;
      first.hostEmployeeId = state.host!.employeeId;
    }
    const jobs: Job[] =
      state.mode === "employee" && !state.options?.digitalIdEligible
        ? []
        : [
            {
              body: first,
              people: state.people.map((entry) => ({ ...entry })),
              started: true,
              photos: [],
              result: null,
              label: state.mode === "employee" ? "Digital ID" : "Visitor pass",
            },
          ];
    for (const extra of state.extras)
      jobs.push({
        body: {
          requestType: "EMPLOYEE_PROJECT",
          clientKey: crypto.randomUUID(),
          projectLocationId: extra.projectLocationId,
          hostEmployeeId: extra.host.employeeId,
          reason: extra.reason,
        },
        people: [{ ...state.people[0], key: crypto.randomUUID() }],
        started: false,
        photos: [],
        result: null,
        label: extra.projectName,
      });
    return jobs;
  }
  function digitalCardRequest(job: Job) {
    if (job.cardRequest) return job.cardRequest;
    const request = send<CardImage>(
      job.body.requestType === "EXTERNAL"
        ? "/api/registration/card"
        : "/api/employee/digital-id/image",
      { visitRequestId: job.result!.visits[0].visitRequestId },
    );
    job.cardRequest = request;
    void request.catch(() => {});
    return request;
  }
  async function renderDigitalCard(job: Job) {
    if (job.cardUrl) return;
    if (job.cardError) return;
    try {
      const image = await digitalCardRequest(job);
      if (!state.jobs?.includes(job) || !resources.alive) return;
      if (
        image.mimeType !== "image/png" ||
        typeof image.imageBase64 !== "string" ||
        image.imageBase64.length > 7340032
      )
        throw Error("Unable to load the card. Please retry.");
      if (!job.cardUrl) {
        job.cardUrl = URL.createObjectURL(
          new Blob(
            [Uint8Array.from(atob(image.imageBase64), (c) => c.charCodeAt(0))],
            { type: "image/png" },
          ),
        );
        job.cardFileName = image.fileName;
      }
      job.cardRequest = null;
      publish();
    } catch (error) {
      job.cardRequest = null;
      if (!state.jobs?.includes(job) || !resources.alive) return;
      job.cardError = true;
      publish();
      notify(
        error instanceof Error ? error.message : "Card could not be loaded.",
        "error",
      );
    }
  }
  function resultBindings(job: Job) {
    if (!job.result) return null;
    const people = new Map(job.people.map((p) => [p.key.toLowerCase(), p])),
      seen = new Set<string>();
    if (
      people.size !== job.people.length ||
      job.result.visits.length !== people.size
    )
      return null;
    const rows = [];
    for (const visit of job.result.visits) {
      const key =
        typeof visit.clientPersonKey === "string"
          ? visit.clientPersonKey.toLowerCase()
          : "";
      if (!people.has(key) || seen.has(key)) return null;
      seen.add(key);
      rows.push({ visit, person: people.get(key)! });
    }
    return rows;
  }
  function showResults() {
    screen("success");
    state.focus = "success-title";
    const done = (state.jobs ?? []).filter((job) => job.result);
    if (done.some((job) => !resultBindings(job))) {
      notify("Pass details could not be matched.", "error");
      return;
    }
    for (const job of done)
      if (["DIGITAL_ID", "EXTERNAL"].includes(job.body.requestType))
        void renderDigitalCard(job);
    publish();
  }
  async function submitJobs() {
    if (state.busy) return;
    if (!state.jobs) state.jobs = prepareJobs();
    const version = flowVersion;
    busy(true);
    stopCamera();
    try {
      for (const job of state.jobs) {
        if (job.result) continue;
        if (!job.started) {
          await send("/api/registration/reset");
          if (version !== flowVersion) return;
          await send("/api/registration/start", {
            requestType: job.body.requestType,
          });
          job.started = true;
        }
        for (let index = 0; index < job.people.length; index++)
          if (!job.photos[index])
            job.photos[index] = (
              await send<{ photoAssetId: string }>(
                "/api/registration/photo",
                job.people[index].file,
                true,
              )
            ).photoAssetId;
        if (!job.payload)
          job.payload = {
            ...job.body,
            people: job.people.map((entry, index) => ({
              clientPersonKey: entry.key,
              photoAssetId: job.photos[index],
              ...(job.body.requestType === "EXTERNAL"
                ? {
                    name: entry.name,
                    phone: entry.phone,
                    ...(entry.companyName
                      ? { companyName: entry.companyName }
                      : {}),
                    ...(entry.deviceTypes.length
                      ? { deviceTypes: entry.deviceTypes }
                      : {}),
                    ...(entry.email ? { email: entry.email } : {}),
                  }
                : {}),
            })),
          };
        job.result = await send<Submitted>(
          "/api/registration/submit",
          job.payload,
        );
        if (version !== flowVersion || !resources.alive) return;
        if (["DIGITAL_ID", "EXTERNAL"].includes(job.body.requestType))
          digitalCardRequest(job);
      }
      showResults();
      notify("Request submitted.", "success");
      if (config.manualReception)
        parent.postMessage(
          { type: "gatepass-manual-submitted" },
          location.origin,
        );
    } catch (error) {
      if (version !== flowVersion || !resources.alive) return;
      const message =
        error instanceof Error ? error.message : "Unable to complete request.";
      if (state.jobs?.some((job) => job.result)) {
        showResults();
        notify("Digital ID saved. " + message, "error");
      } else if (
        error instanceof Failure &&
        [400, 403, 409].includes(error.status)
      ) {
        state.jobs = null;
        notify(message, "error");
      } else if (error instanceof Failure && error.status === 401) {
        state.jobs = null;
        screen("sign-in-screen");
        notify(message, "error");
      } else notify(message + " Retry will use the same request.", "error");
    } finally {
      if (version === flowVersion) busy(false);
    }
  }
  const model = {
    ...store,
    state,
    send,
    auth,
    steps,
    photoStep,
    person,
    beginFlow,
    screen,
    renderStep,
    reset,
    setEmployee,
    renderProjects,
    searchHosts,
    validateDetails,
    validateVisit,
    purpose,
    prepareJobs,
    digitalCardRequest,
    renderDigitalCard,
    resultBindings,
    showResults,
    submitJobs,
    stopCamera,
    openCamera,
    capture,
    useCapturedPhoto,
    applyPhotoTransform,
    commitPhotoCrop,
    editAccess,
    closeAccessDialog,
    notify,
    setField(
      name:
        | "email"
        | "password"
        | "reason"
        | "reasonDetails"
        | "validUntil"
        | "purpose"
        | "purposeDetails",
      value: string,
    ) {
      state[name] = value;
      publish();
    },
    setPerson(patch: Partial<Person>) {
      Object.assign(state.people[0], patch);
      publish();
    },
    selectProject(value: string) {
      state.projectId = value;
      state.searchVersion++;
      state.host = null;
      state.hosts = [];
      state.hostQuery = state.hostFeedback = "";
      state.hostsOpen = false;
      publish();
    },
    setHostQuery(value: string) {
      resources.clearTimeout(searchTimer);
      state.searchVersion++;
      state.hostQuery = value;
      state.host = null;
      state.hosts = [];
      state.hostsOpen = false;
      state.hostFeedback = "";
      publish();
      searchTimer = resources.timeout(() => void searchHosts(), 350);
    },
    selectHost(host: Host) {
      if (state.busy || state.jobs || !state.hosts.includes(host)) return;
      resources.clearTimeout(searchTimer);
      state.searchVersion++;
      state.host = host;
      state.hostQuery = host.displayName;
      state.hostsOpen = false;
      state.hostFeedback = host.officialEmail;
      publish();
    },
    addExtra() {
      if (!validateVisit() || !state.host) return;
      const project = state.options?.projects.find(
        (p) => p.projectLocationId === state.projectId,
      );
      if (!project) return;
      state.extras = [
        ...state.extras,
        {
          projectLocationId: project.projectLocationId,
          projectName: project.projectName,
          host: state.host,
          reason: purpose(),
        },
      ];
      closeAccessDialog();
      publish();
    },
    removeExtra(id: string) {
      if (state.jobs || state.busy) return;
      state.extras = state.extras.filter((v) => v.projectLocationId !== id);
      publish();
    },
    async next() {
      if (state.busy) return;
      if (state.step === 0 && !validateDetails()) return;
      if (state.mode === "visitor" && state.step === 1 && !validateVisit()) {
        publish();
        return;
      }
      if (state.step === photoStep()) {
        busy(true);
        try {
          await commitPhotoCrop();
        } catch (error) {
          notify(
            error instanceof Error ? error.message : "Photo unavailable.",
            "error",
          );
          return;
        } finally {
          busy(false);
        }
      }
      renderStep(state.step + 1);
    },
    previous() {
      if (state.busy || state.jobs) return;
      if (state.accessEditor) {
        closeAccessDialog();
        return;
      }
      if (state.step === 0) {
        reset();
        screen("landing");
      } else renderStep(state.step - 1);
    },
    async employeeChoice() {
      if (state.busy) return;
      state.mode = "employee";
      screen("sign-in-screen");
      busy(true);
      try {
        const result = await auth<{ employee: Employee }>("me");
        setEmployee(result.employee);
        busy(false);
        await beginFlow("employee");
      } catch (error) {
        if (!(error instanceof Failure && error.status === 401))
          notify(
            error instanceof Error ? error.message : "Sign in unavailable.",
            "error",
          );
        state.focus = "employee-email";
      } finally {
        busy(false);
      }
    },
    async signIn() {
      if (state.busy || !state.email.trim() || !state.password) return;
      const password = state.password;
      state.password = "";
      notify();
      busy(true);
      const version = flowVersion;
      try {
        const result = await auth<{ employee: Employee }>("login", {
          email: state.email.trim(),
          password,
        });
        if (version !== flowVersion || !resources.alive) return;
        setEmployee(result.employee);
        busy(false);
        await beginFlow("employee");
      } catch (error) {
        if (version === flowVersion) {
          notify(
            error instanceof Failure && error.status === 401
              ? "Email or password is incorrect."
              : error instanceof Error
                ? error.message
                : "Sign in unavailable.",
            "error",
          );
          state.focus = "employee-password";
        }
      } finally {
        busy(false);
      }
    },
    togglePassword() {
      state.showPassword = !state.showPassword;
      publish();
    },
    signInBack() {
      state.password = "";
      screen("landing");
    },
    async leaveFlow() {
      if (state.busy) return;
      if (config.manualReception) {
        stopCamera();
        parent.postMessage({ type: "gatepass-manual-close" }, location.origin);
        return;
      }
      busy(true);
      try {
        if (state.employee)
          try {
            await auth("logout");
          } catch (error) {
            if (!(
              error instanceof Failure && [401, 403].includes(error.status)
            ))
              throw error;
          }
        reset();
        state.employee = null;
        screen("landing");
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "Unable to close.",
          "error",
        );
      } finally {
        busy(false);
      }
    },
    retake() {
      const entry = state.people[state.photoIndex];
      if (entry.url) URL.revokeObjectURL(entry.url);
      if (entry.croppedUrl) URL.revokeObjectURL(entry.croppedUrl);
      entry.file = null;
      entry.url = null;
      entry.croppedUrl = undefined;
      publish();
      void openCamera();
    },
    setZoom(value: number) {
      const entry = state.people[state.photoIndex];
      entry.zoom = Math.max(1, Math.min(3, value));
      applyPhotoTransform();
    },
    pan(x: number, y: number) {
      const entry = state.people[state.photoIndex];
      entry.pan = { x, y };
      applyPhotoTransform();
    },
    flip() {
      const entry = state.people[state.photoIndex];
      entry.flipped = !entry.flipped;
      applyPhotoTransform();
    },
    resetPhoto() {
      const entry = state.people[state.photoIndex];
      entry.zoom = 1;
      entry.pan = { x: 0, y: 0 };
      entry.flipped = false;
      applyPhotoTransform();
    },
    retryCard(job: Job) {
      job.cardError = false;
      publish();
      void renderDigitalCard(job);
    },
    dismissNotice(id: number) {
      state.notices = state.notices.filter((v) => v.id !== id);
      publish();
    },
    start() {
      resources.start();
      history.replaceState(navigationState(), "");
      resources.on(window, "pagehide", () => {
        flowVersion++;
        state.password = "";
        stopCamera();
      });
      resources.on(document, "visibilitychange", () => {
        if (document.hidden) stopCamera();
      });
      resources.on(window, "popstate", (event) => {
        const target = (event as PopStateEvent).state;
        if (!target?.gatepass) return;
        if (state.busy || state.jobs) {
          history.pushState(navigationState(), "");
          return;
        }
        restoring = true;
        try {
          state.password = "";
          if (target.view === "sign-in-screen") screen("sign-in-screen");
          else if (
            target.view === "flow" &&
            target.flow === flowVersion &&
            state.options
          ) {
            screen("flow");
            renderStep(target.step);
          } else screen("landing");
        } finally {
          restoring = false;
          history.replaceState(navigationState(), "");
        }
      });
      inspectForTests(
        {
          state: () => state,
          person: () => person,
          screen: () => screen,
          renderStep: () => renderStep,
          renderPeople: () => publish,
          setEmployee: () => setEmployee,
          renderPhoto: () => publish,
          useCapturedPhoto: () => useCapturedPhoto,
          applyPhotoTransform: () => applyPhotoTransform,
          photoStep: () => photoStep,
          prepareJobs: () => prepareJobs,
          submitJobs: () => submitJobs,
          showResults: () => showResults,
          digitalCardRequest: () => digitalCardRequest,
          beginFlow: () => beginFlow,
          renderProjects: () => renderProjects,
          editAccess: () => editAccess,
          closeAccessDialog: () => closeAccessDialog,
        },
        resources,
      );
      if (config.manualReception) void beginFlow("visitor");
    },
    dispose() {
      flowVersion++;
      reset();
      state.password = "";
      resources.dispose();
      store.clear();
    },
  };
  return model;
}
export type SelfServiceModel = ReturnType<typeof createSelfServiceModel>;
