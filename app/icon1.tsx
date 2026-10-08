import { ImageResponse } from "next/og";
import { BrandIcon } from "./brand-icon";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<BrandIcon size={size.width} />, size);
}
