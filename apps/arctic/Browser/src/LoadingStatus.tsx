import { useEffect, useState } from "react";

// Local reads normally finish before this status needs to appear.
export function LoadingStatus({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 400);
    return () => clearTimeout(timer);
  }, []);
  return visible ? (
    <p className={className} role="status">
      {children}
    </p>
  ) : null;
}
