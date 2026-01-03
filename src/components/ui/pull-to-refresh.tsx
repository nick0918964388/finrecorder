'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

interface PullToRefreshProps {
  children: React.ReactNode;
  onRefresh?: () => Promise<void>;
  threshold?: number;
  className?: string;
}

// iOS-style spinner component
function IOSSpinner({ progress, isRefreshing }: { progress: number; isRefreshing: boolean }) {
  const segments = 12;

  return (
    <div className="relative w-5 h-5">
      {Array.from({ length: segments }).map((_, i) => {
        const rotation = (i * 360) / segments;
        const delay = isRefreshing ? `${(i * 0.08)}s` : '0s';
        // When pulling, show segments based on progress
        const segmentProgress = i / segments;
        const opacity = isRefreshing
          ? 0.25 + (0.75 * ((segments - i) / segments))
          : progress >= segmentProgress ? 0.3 + (progress * 0.7) : 0.1;

        return (
          <div
            key={i}
            className="absolute left-1/2 top-0 w-[2px] h-[6px] rounded-full bg-current origin-[50%_10px]"
            style={{
              transform: `rotate(${rotation}deg)`,
              opacity,
              animation: isRefreshing ? `ios-spinner 1s linear infinite` : 'none',
              animationDelay: delay,
            }}
          />
        );
      })}
      <style jsx>{`
        @keyframes ios-spinner {
          0% { opacity: 1; }
          100% { opacity: 0.25; }
        }
      `}</style>
    </div>
  );
}

export function PullToRefresh({
  children,
  onRefresh,
  threshold = 60,
  className,
}: PullToRefreshProps) {
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const startY = useRef(0);
  const currentY = useRef(0);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      if (onRefresh) {
        await onRefresh();
      } else {
        // Default: invalidate all queries
        await queryClient.invalidateQueries();
      }
    } finally {
      setIsRefreshing(false);
      setPullDistance(0);
    }
  }, [onRefresh, queryClient]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const container = containerRef.current;
    if (!container || isRefreshing) return;

    // Only enable pull to refresh when at top of scroll
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    if (scrollTop > 0) return;

    startY.current = e.touches[0].clientY;
    setIsPulling(true);
  }, [isRefreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isPulling || isRefreshing) return;

    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    if (scrollTop > 0) {
      setPullDistance(0);
      return;
    }

    currentY.current = e.touches[0].clientY;
    const diff = currentY.current - startY.current;

    if (diff > 0) {
      // Apply resistance - pull distance is less than actual finger movement
      const resistance = 0.5;
      const distance = Math.min(diff * resistance, threshold * 1.8);
      setPullDistance(distance);

      // Prevent default scroll when pulling
      if (distance > 5) {
        e.preventDefault();
      }
    }
  }, [isPulling, isRefreshing, threshold]);

  const handleTouchEnd = useCallback(() => {
    if (!isPulling) return;

    setIsPulling(false);

    if (pullDistance >= threshold && !isRefreshing) {
      handleRefresh();
    } else {
      setPullDistance(0);
    }
  }, [isPulling, pullDistance, threshold, isRefreshing, handleRefresh]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Use passive: false to allow preventDefault
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const progress = Math.min(pullDistance / threshold, 1);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* iOS-style pull indicator */}
      <div
        className="absolute left-0 right-0 flex items-center justify-center overflow-hidden pointer-events-none z-50"
        style={{
          top: 0,
          height: pullDistance,
          transition: isPulling ? 'none' : 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div
          className="text-muted-foreground"
          style={{
            opacity: Math.min(progress * 1.5, 1),
            transform: `scale(${0.6 + progress * 0.4})`,
            transition: isPulling ? 'none' : 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <IOSSpinner progress={progress} isRefreshing={isRefreshing} />
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: isPulling ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
