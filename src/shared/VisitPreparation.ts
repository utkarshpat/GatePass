export const visitorCategories = {
  GENERAL: "General visitor",
  CLIENT: "Client",
  VENDOR: "Vendor",
  CANDIDATE: "Candidate",
  CONTRACTOR: "Contractor",
  SUPPORT_STAFF: "Support staff",
  REGULATOR: "Regulator",
  INTERNAL: "Internal guest",
} as const;
export const visitTypes = {
  MEETING: "Business meeting",
  INTERVIEW: "Interview",
  SERVICE: "Service / maintenance",
  SITE_TOUR: "Site tour",
  LEADERSHIP: "Leadership visit",
} as const;
export const preparationServices = {
  MEETING_ROOM: "Meeting room",
  AV_SUPPORT: "AV / video conference support",
  HOSPITALITY: "Hospitality / refreshments",
  PARKING: "Parking",
  TRANSPORT: "Ground transport / transfers",
  TRAVEL: "Travel arrangements",
  ACCESSIBILITY: "Accessibility assistance",
} as const;
export const preparationDevices = {
  LAPTOP: "Laptop",
  TABLET: "Tablet / iPad",
  CAMERA: "Camera",
  PEN_DRIVE: "Pen drive",
  OTHER: "Other device",
} as const;
export const specialAccessRequests = {
  NETWORK: "Network access",
  RECORDING: "Photography / recording",
  AFTER_HOURS: "After-hours visit",
  RESTRICTED_AREA: "Restricted area",
  DATA_CENTRE: "Data centre / communications room",
} as const;
export type VisitPreparation = {
  category: keyof typeof visitorCategories;
  visitType: keyof typeof visitTypes;
  meetingLocation?: string;
  agenda?: string;
  requirements?: string;
  services: (keyof typeof preparationServices)[];
  devices: (keyof typeof preparationDevices)[];
  specialAccess: (keyof typeof specialAccessRequests)[];
  coordinatorId?: string;
  /** Legacy key for an additional FYI contact; never transfers invitation ownership. */
  visitOwnerId?: string;
  alternateReceiverId?: string;
};
export type AdditionalPlanningPerson = {
  userId: string;
  kind: "APPROVAL" | "NOTIFY";
  subProjectId?: string;
};
