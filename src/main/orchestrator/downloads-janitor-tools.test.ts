import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  scanDuplicatesInDirectory,
  cleanDuplicatesInDirectory,
  formatBytes,
  computeFileHash,
  sortFilesByOriginality,
} from "./downloads-janitor-tools";

describe("DownloadsJanitorTools", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "janitor-test-"));
  });

  it("formats bytes into human readable units", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.50 GB");
  });

  it("correctly identifies original file vs copy file names", () => {
    const files = [
      "/downloads/quarterly-report (1).pdf",
      "/downloads/quarterly-report.pdf",
      "/downloads/quarterly-report - Copy.pdf",
    ];
    const sorted = sortFilesByOriginality(files);
    expect(sorted[0]).toBe("/downloads/quarterly-report.pdf");
  });

  it("computes identical hashes for duplicate file contents", () => {
    const file1 = path.join(tmpDir, "sample1.txt");
    const file2 = path.join(tmpDir, "sample2.txt");
    const content = "This is a test content that will be identical across files.".repeat(20);

    fs.writeFileSync(file1, content);
    fs.writeFileSync(file2, content);

    const hash1 = computeFileHash(file1);
    const hash2 = computeFileHash(file2);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
  });

  it("detects duplicate groups and recoverable bytes", async () => {
    const original = path.join(tmpDir, "contract.pdf");
    const copy1 = path.join(tmpDir, "contract (1).pdf");
    const copy2 = path.join(tmpDir, "contract (2).pdf");
    const different = path.join(tmpDir, "different.pdf");

    const contentA = "Binary data payload for duplicate test".repeat(50);
    const contentB = "Unique non-matching payload".repeat(50);

    fs.writeFileSync(original, contentA);
    fs.writeFileSync(copy1, contentA);
    fs.writeFileSync(copy2, contentA);
    fs.writeFileSync(different, contentB);

    const scan = await scanDuplicatesInDirectory(tmpDir, 100);
    expect(scan.scannedCount).toBe(4);
    expect(scan.duplicateGroupCount).toBe(1);
    expect(scan.totalDuplicateFiles).toBe(2);
    expect(scan.recoverableBytes).toBe(Buffer.byteLength(contentA) * 2);

    const cluster = scan.clusters[0];
    expect(cluster.original).toBe(original);
    expect(cluster.duplicates).toContain(copy1);
    expect(cluster.duplicates).toContain(copy2);
  });

  it("safely cleans duplicate files while preserving original", async () => {
    const original = path.join(tmpDir, "setup.exe");
    const duplicate = path.join(tmpDir, "setup (1).exe");
    const payload = "Installer byte payload content".repeat(60);

    fs.writeFileSync(original, payload);
    fs.writeFileSync(duplicate, payload);

    const result = await cleanDuplicatesInDirectory(tmpDir, true); // autoConfirm = true
    expect(result).toContain("Successfully moved 1 duplicate file(s)");
    expect(result).toContain("Original files preserved: 1");

    // Original must still exist
    expect(fs.existsSync(original)).toBe(true);
    // Duplicate must be removed
    expect(fs.existsSync(duplicate)).toBe(false);
  });
});
