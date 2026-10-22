import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { VideoJob } from "./video.types";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { VideosService } from "./videos.service";

const storageRoot = process.env.STORAGE_ROOT ?? join(process.cwd(), "../../storage");
const uploadRoot = join(storageRoot, "uploads");
mkdirSync(uploadRoot, { recursive: true });

@Controller("videos")
export class VideosController {
  public constructor(private readonly videosService: VideosService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: uploadRoot,
        filename: (_request, file, callback) => {
          const extension = file.originalname.split(".").pop()?.toLowerCase() ?? "mp4";
          callback(null, `${randomUUID()}.${extension}`);
        }
      }),
      limits: { fileSize: 500 * 1024 * 1024 },
      fileFilter: (_request, file, callback) => {
        if (!file.mimetype.startsWith("video/")) {
          callback(new BadRequestException("Chỉ chấp nhận file video."), false);
          return;
        }

        callback(null, true);
      }
    })
  )
  public async upload(@UploadedFile() file: Express.Multer.File | undefined): Promise<VideoJob> {
    if (file === undefined) {
      throw new BadRequestException("Vui lòng chọn một file video.");
    }

    return this.videosService.createJob(file);
  }

  @Get()
  public list(): VideoJob[] {
    return this.videosService.listJobs();
  }

  @Get(":id")
  public get(@Param("id") id: string): VideoJob {
    return this.videosService.getJob(id);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  public cancel(@Param("id") id: string): VideoJob {
    return this.videosService.cancelJob(id);
  }

  @Get(":id/result")
  public getResult(@Param("id") id: string): Pick<VideoJob, "id" | "status" | "detections" | "annotatedVideoUrl"> {
    const job = this.videosService.getJob(id);

    return {
      id: job.id,
      status: job.status,
      detections: job.detections,
      annotatedVideoUrl: job.annotatedVideoUrl
    };
  }
}

