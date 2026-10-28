import { Controller, Query, Sse } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { filter, map } from "rxjs";
import type { Observable } from "rxjs";
import { CurrentUser } from "../auth/current-user.decorator";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SitesService } from "../sites/sites.service";
import type { SafeUser } from "../users/user.types";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GatePassesService } from "./gate-passes.service";
import type { GateEvent } from "./gate-passes.service";

@Controller("live")
export class LiveController {
  public constructor(
    private readonly gatePasses: GatePassesService,
    private readonly sites: SitesService
  ) {}

  /** Server-Sent Events: mỗi lượt xe tạo/cập nhật/xoá được đẩy ngay tới client, lọc theo đúng cơ sở
   *  đang chọn (ADMIN không truyền siteId mới nhận hết mọi cơ sở). */
  @Sse("events")
  public events(@CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Observable<MessageEvent> {
    const scope = this.sites.resolveSiteScope(user, siteId);
    return this.gatePasses.events.pipe(
      filter((event: GateEvent) => "allSites" in scope || (event.type === "upsert" ? event.pass.siteId === scope.siteId : event.siteId === scope.siteId)),
      map((event): MessageEvent => ({ data: event }))
    );
  }
}
