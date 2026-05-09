declare module "mammoth/mammoth.browser" {
  export type ExtractRawTextResult = {
    value: string;
    messages: Array<{
      type: string;
      message: string;
    }>;
  };

  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<ExtractRawTextResult>;

  export type ConvertToHtmlResult = {
    value: string;
    messages: Array<{
      type: string;
      message: string;
    }>;
  };

  export type MammothImage = {
    contentType: string;
    read: (encoding: "base64") => Promise<string>;
  };

  export const images: {
    inline: (
      convertImage: (image: MammothImage) => Promise<{ src: string }>
    ) => unknown;
  };

  export function convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: { convertImage?: unknown }
  ): Promise<ConvertToHtmlResult>;
}
