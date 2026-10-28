export type PageName =
  "staff" | "self-service" | "guard" | "reception" | "admin" | "email";
export type PageConfig = {
  page: PageName;
  companyLogo: string;
  gatepassLogo: string;
  officeCode: string;
  officeName: string;
  manualReception: boolean;
  qrDecoderUrl: string;
  exportWorkerUrl: string;
};
export type PageProps = { config: PageConfig };
