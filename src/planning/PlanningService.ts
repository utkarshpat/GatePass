import type { SqlProcedurePort } from "../contracts/Sql.ts";
import { sessionIdentity } from "../security/SessionProof.ts";
import type { Session } from "../security/SessionProof.ts";
import { planningRequest } from "./PlanningRequest.ts";
import type { PlanningAction } from "./PlanningRequest.ts";
import { planningResponse } from "./PlanningProjection.ts";
import { PlanningError } from "./Types.ts";
export { validatePlanningDefinition } from "./PlanningRequest.ts";
export type { PlanningAction } from "./PlanningRequest.ts";
/** Application orchestration; input/projection policies stay pure and SQL owns transactions. */
export class PlanningService {
  readonly #client: SqlProcedurePort;
  constructor(client: SqlProcedurePort) {
    this.#client = client;
  }
  async execute(session: Session, action: PlanningAction, raw: unknown) {
    const call = planningRequest(action, raw);
    const parameters = { ...sessionIdentity(session), ...call.parameters };
    try {
      return planningResponse(
        action,
        await this.#client.callProcedure(call.procedure, parameters),
      );
    } catch (error) {
      if (error instanceof PlanningError) throw error;
      const n = Number((error as { number?: unknown })?.number);
      throw new PlanningError(
        n === 52001
          ? "NOT_AUTHORIZED"
          : n === 52002 || n === 547
            ? "INVALID_INPUT"
            : n === 52003 || n === 2601 || n === 2627
              ? "CONFLICT"
              : n === 52004
                ? "POLICY_UNAVAILABLE"
                : "UNAVAILABLE",
      );
    }
  }
}
