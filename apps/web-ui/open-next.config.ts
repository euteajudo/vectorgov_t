/**
 * Config do OpenNext Cloudflare.
 *
 * Defaults funcionam para nosso caso (App Router puro, sem ISR, sem
 * background revalidation, cache só no edge). Mantemos o arquivo apenas
 * para o build script encontrá-lo.
 */
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
