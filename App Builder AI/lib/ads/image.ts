import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const IMAGE_MODEL = process.env.ADS_IMAGE_MODEL_ID?.trim() || 'amazon.nova-canvas-v1:0';

/** Generates a square ad image and returns it as base64 (PNG). */
export async function generateAdImage(prompt: string): Promise<string> {
  const client = new BedrockRuntimeClient({
    region: process.env.ADS_IMAGE_REGION?.trim() || process.env.AWS_REGION || 'us-east-1',
  });
  const response = await client.send(
    new InvokeModelCommand({
      modelId: IMAGE_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        taskType: 'TEXT_IMAGE',
        textToImageParams: {
          text: prompt.slice(0, 1000),
          negativeText: 'text, letters, words, watermark, logo, distorted, low quality',
        },
        imageGenerationConfig: { numberOfImages: 1, width: 1024, height: 1024, quality: 'standard' },
      }),
    }),
  );
  const parsed = JSON.parse(new TextDecoder().decode(response.body)) as {
    images?: string[];
    error?: string;
  };
  const image = parsed.images?.[0];
  if (!image) throw new Error(parsed.error ?? 'Image model returned no image.');
  return image;
}
