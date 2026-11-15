import { useState, type ImgHTMLAttributes } from "react";
import type { ImageRef } from "../types.ts";

/** Shows the local copy of an image, falling back to the remote original. */
export function Img({ image, className = "", ...rest }: { image: ImageRef | null } & ImgHTMLAttributes<HTMLImageElement>) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null);

    if (!image) {
        return (
            <div className={`flex items-center justify-center bg-stone-100 text-xs text-stone-400 dark:bg-stone-800 ${className}`}>
                No photo
            </div>
        );
    }

    const src = failedSrc === image.src ? image.remote : image.src;
    return (
        <img
            src={src}
            loading="lazy"
            onError={() => failedSrc !== image.src && setFailedSrc(image.src)}
            className={`bg-stone-100 object-cover dark:bg-stone-800 ${className}`}
            {...rest}
        />
    );
}
