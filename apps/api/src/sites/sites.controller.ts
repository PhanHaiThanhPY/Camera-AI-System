import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { SafeUser } from "../users/user.types";
import type { CameraInput, SiteUpdateInput } from "./sites.service";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SitesService } from "./sites.service";
import type { Site, SiteCamera } from "./site.types";

type JsonBody = Record<string, unknown> | undefined;

function record(body: JsonBody): Record<string, unknown> {
  if (typeof body !== "object" || body === null) {
    throw new BadRequestException("Body phải là JSON object.");
  }
  return body;
}

function text(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`${key} phải là chuỗi.`);
  }
  return value.trim();
}

function requiredName(body: JsonBody): string {
  const name = text(record(body), "name");
  if (name === undefined || name === "") {
    throw new BadRequestException("name là bắt buộc.");
  }
  return name;
}

function parseSiteUpdate(body: JsonBody): SiteUpdateInput {
  const source = record(body);
  const input: SiteUpdateInput = {};
  const name = text(source, "name");
  const scaleId = text(source, "scaleId");
  const weighbridgeApiKey = text(source, "weighbridgeApiKey");
  if (name !== undefined) {
    input.name = name;
  }
  if (scaleId !== undefined) {
    input.scaleId = scaleId;
  }
  if (weighbridgeApiKey !== undefined) {
    input.weighbridgeApiKey = weighbridgeApiKey;
  }
  return input;
}

function parseCamera(body: JsonBody): CameraInput {
  const source = record(body);
  const input: CameraInput = {};
  const label = text(source, "label");
  const rtspUrl = text(source, "rtspUrl");
  if (label !== undefined) {
    input.label = label;
  }
  if (rtspUrl !== undefined) {
    input.rtspUrl = rtspUrl;
  }
  return input;
}

/** Cơ sở (Site) của từng đối tác — camera + trạm cân riêng. USER chỉ đụng được cơ sở của mình,
 *  ADMIN xem/sửa được mọi cơ sở (đúng yêu cầu "admin xem được hết"). */
@Controller("sites")
export class SitesController {
  public constructor(private readonly sites: SitesService) {}

  @Get()
  public list(@CurrentUser() user: SafeUser): Site[] | (Site & { ownerName: string; ownerEmail: string })[] {
    return user.role === "ADMIN" ? this.sites.listAllWithOwner() : this.sites.listForOwner(user.id);
  }

  @Get(":id/cameras")
  public listCameras(@Param("id") id: string, @CurrentUser() user: SafeUser): SiteCamera[] {
    const site = this.sites.getSite(id);
    this.sites.assertAccess(site, user);
    return this.sites.camerasOf(id);
  }

  @Post()
  public createSite(@Body() body: JsonBody, @CurrentUser() user: SafeUser): Promise<Site> {
    return this.sites.createSite(user.id, requiredName(body));
  }

  @Patch(":id")
  public updateSite(@Param("id") id: string, @Body() body: JsonBody, @CurrentUser() user: SafeUser): Promise<Site> {
    this.sites.assertAccess(this.sites.getSite(id), user);
    return this.sites.updateSite(id, parseSiteUpdate(body));
  }

  @Delete(":id")
  @HttpCode(200)
  public async deleteSite(@Param("id") id: string, @CurrentUser() user: SafeUser): Promise<{ ok: true }> {
    this.sites.assertAccess(this.sites.getSite(id), user);
    await this.sites.deleteSite(id);
    return { ok: true };
  }

  @Post(":id/cameras")
  public addCamera(@Param("id") id: string, @Body() body: JsonBody, @CurrentUser() user: SafeUser): Promise<SiteCamera> {
    this.sites.assertAccess(this.sites.getSite(id), user);
    return this.sites.addCamera(id, parseCamera(body));
  }

  @Patch("cameras/:cameraRowId")
  public updateCamera(@Param("cameraRowId") cameraRowId: string, @Body() body: JsonBody, @CurrentUser() user: SafeUser): Promise<SiteCamera> {
    const camera = this.sites.getCamera(cameraRowId);
    this.sites.assertAccess(this.sites.getSite(camera.siteId), user);
    return this.sites.updateCamera(cameraRowId, parseCamera(body));
  }

  @Delete("cameras/:cameraRowId")
  @HttpCode(200)
  public async removeCamera(@Param("cameraRowId") cameraRowId: string, @CurrentUser() user: SafeUser): Promise<{ ok: true }> {
    const camera = this.sites.getCamera(cameraRowId);
    this.sites.assertAccess(this.sites.getSite(camera.siteId), user);
    await this.sites.removeCamera(cameraRowId);
    return { ok: true };
  }
}
