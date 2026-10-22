import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Lưu state dạng JSON trong storage để không mất khi API khởi động lại. Ghi trễ và ghi nguyên tử (file tạm rồi rename). */
export class JsonStore<T> {
  private timer: NodeJS.Timeout | null = null;

  public constructor(
    private readonly path: string,
    private readonly delayMs = 300
  ) {}

  public load(): T | null {
    if (!existsSync(this.path)) {
      return null;
    }
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as T;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown read error";
      throw new Error(`Cannot load JSON store ${this.path}: ${message}`);
    }
  }

  public save(snapshot: () => T): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush(snapshot());
    }, this.delayMs);
  }

  public flush(data: T): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(data), "utf8");
    renameSync(temp, this.path);
  }
}
