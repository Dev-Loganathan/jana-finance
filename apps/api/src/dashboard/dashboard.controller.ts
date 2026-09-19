import { Controller, Get } from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../common/decorators";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
export class DashboardController {
  constructor(private dashboard: DashboardService) {}

  /** Any signed-in user may call this; each section is filtered by the caller's own permissions. */
  @Get()
  get(@CurrentUser() actor: AuthUser) {
    return this.dashboard.get(actor);
  }
}
