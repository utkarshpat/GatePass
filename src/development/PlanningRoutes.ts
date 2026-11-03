import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpFailure, readJsonBody } from "../transport/ApiHandler.ts";
import type { AdditionalHttpRoutes } from "../transport/ApiHandler.ts";
import { PlanningService } from "../planning/PlanningService.ts";
import type { PlanningAction } from "../planning/PlanningService.ts";
import { PlanningError } from "../planning/Types.ts";
type Session = { sessionToken: string; csrfToken: string };
type Auth = {
  session(req: IncomingMessage): Session;
  verify(session: Session): Promise<boolean>;
};
export class PlanningRoutes implements AdditionalHttpRoutes {
  #auth: Auth;
  #service: PlanningService;
  constructor(auth: Auth, service: PlanningService) {
    this.#auth = auth;
    this.#service = service;
  }
  handles(path: string) {
    return /^\/api\/coordination\/(options|people|groups|routing|list|detail|thread|create|change|manage)$/u.test(
      path,
    );
  }
  async handle(req: IncomingMessage, _res: ServerResponse) {
    if (!this.handles(req.url ?? "")) throw new HttpFailure(404);
    const session = this.#auth.session(req);
    if (!(await this.#auth.verify(session))) throw new HttpFailure(401);
    try {
      return await this.#service.execute(
        session,
        req.url!.split("/").at(-1) as PlanningAction,
        await readJsonBody(req),
      );
    } catch (error) {
      if (error instanceof PlanningError)
        throw new HttpFailure(
          {
            INVALID_INPUT: 400,
            NOT_AUTHORIZED: 403,
            CONFLICT: 409,
            POLICY_UNAVAILABLE: 409,
            UNAVAILABLE: 503,
          }[error.code],
        );
      throw error;
    }
  }
}
