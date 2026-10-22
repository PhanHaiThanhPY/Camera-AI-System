import { Controller, Sse } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { map } from "rxjs";
import type { Observable } from "rxjs";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GatePassesService } from "./gate-passes.service";

@Controller("live")
export class LiveController {
  public constructor(private readonly gatePasses: GatePassesService) {}

  /** Server-Sent Events: mỗi lượt xe tạo/cập nhật/xoá được đẩy ngay tới client. */
  @Sse("events")
  public events(): Observable<MessageEvent> {
    return this.gatePasses.events.pipe(map((event): MessageEvent => ({ data: event })));
  }
}
