"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import {
  MediaControlBar,
  MediaController,
  MediaDurationDisplay,
  MediaErrorDialog,
  MediaFullscreenButton,
  MediaLoadingIndicator,
  MediaMuteButton,
  MediaPipButton,
  MediaPlayButton,
  MediaSeekBackwardButton,
  MediaSeekForwardButton,
  MediaTimeDisplay,
  MediaTimeRange,
  MediaVolumeRange,
} from "media-chrome/react"
import type { CSSProperties } from "react"

import { cn } from "@/lib/utils"

const videoPlayerVariants = cva(
  "group relative w-full touch-manipulation overflow-hidden rounded-2xl bg-black",
  {
    variants: {
      size: {
        sm: "max-w-md",
        default: "max-w-2xl",
        lg: "max-w-4xl",
        full: "w-full",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

export interface VideoPlayerProps
  extends
    Omit<React.VideoHTMLAttributes<HTMLVideoElement>, "controls">,
    VariantProps<typeof videoPlayerVariants> {
  src: string
  poster?: string
  showControls?: boolean
  autoHide?: boolean
  className?: string
}

const mediaChromeStyle = {
  "--media-background-color": "transparent",
  "--media-control-background": "transparent",
  "--media-control-hover-background": "rgba(255,255,255,0.16)",
  "--media-control-padding": "0.5rem",
  "--media-font": "var(--font-sans)",
  "--media-font-size": "0.75rem",
  "--media-icon-color": "#fff",
  "--media-primary-color": "#fff",
  "--media-range-bar-color": "#fff",
  "--media-range-track-background": "rgba(255,255,255,0.28)",
  "--media-secondary-color": "rgba(255,255,255,0.72)",
  "--media-text-color": "#fff",
  "--media-tooltip-display": "none",
} as CSSProperties

const mediaButtonClass =
  "rounded-md text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"

const VideoPlayer = React.forwardRef<HTMLVideoElement, VideoPlayerProps>(
  (
    {
      className,
      size,
      src,
      poster,
      showControls = true,
      autoHide = true,
      ...props
    },
    ref
  ) => {
    const videoRef = React.useRef<HTMLVideoElement>(null)

    React.useImperativeHandle(ref, () => videoRef.current as HTMLVideoElement)

    return (
      <MediaController
        aria-label="Video player"
        autohide={autoHide ? "2.5" : undefined}
        className={cn(
          videoPlayerVariants({ size }),
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-safe:duration-200 motion-reduce:animate-none",
          className
        )}
        noAutohide={autoHide ? undefined : true}
        role="region"
        style={mediaChromeStyle}
      >
        <video
          aria-label="Video"
          className="h-full w-full object-contain"
          poster={poster}
          ref={videoRef}
          slot="media"
          src={src}
          {...props}
        />

        {showControls ? (
          <>
            <MediaLoadingIndicator
              className="pointer-events-none absolute inset-0 m-auto size-10 text-white"
              noAutohide
            />
            <MediaErrorDialog className="text-white" />

            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <MediaPlayButton
                className="pointer-events-auto flex size-16 items-center justify-center rounded-full border border-white/30 bg-white/20 text-white backdrop-blur-sm transition-colors hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              />
            </div>

            <MediaControlBar className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-linear-to-t from-black/80 via-black/40 to-transparent p-4 text-white">
              <div className="flex items-center gap-2">
                <MediaTimeDisplay className="min-w-10 font-mono text-xs" />
                <MediaTimeRange className="min-w-0 flex-1" />
                <MediaDurationDisplay className="min-w-10 font-mono text-xs" />
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MediaSeekBackwardButton
                    className={mediaButtonClass}
                    seekOffset={10}
                  />
                  <MediaPlayButton className={mediaButtonClass} />
                  <MediaSeekForwardButton
                    className={mediaButtonClass}
                    seekOffset={10}
                  />
                  <MediaMuteButton className={mediaButtonClass} />
                  <MediaVolumeRange className="w-20" />
                </div>

                <div className="flex items-center gap-2">
                  <MediaPipButton className={mediaButtonClass} />
                  <MediaFullscreenButton className={mediaButtonClass} />
                </div>
              </div>
            </MediaControlBar>
          </>
        ) : null}
      </MediaController>
    )
  }
)

VideoPlayer.displayName = "VideoPlayer"

export { VideoPlayer }
