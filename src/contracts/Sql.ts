/** Application-owned RPC port. Driver, connection and role admission stay in adapters. */
export type SqlParameter = {
  type:
    "binary" | "text" | "bit" | "guid" | "int" | "bigint" | "datetime" | "date";
  value: Buffer | string | boolean | number | null;
};

export interface SqlProcedurePort {
  callProcedure(
    name: string,
    parameters: Record<string, SqlParameter>,
  ): Promise<string>;
}
