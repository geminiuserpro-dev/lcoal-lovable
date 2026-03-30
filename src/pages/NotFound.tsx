import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import ErrorLayout from "@/components/ErrorLayout";
import { Search } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <ErrorLayout
      code="404"
      title="Page Not Found"
      description="The page you're looking for doesn't exist or has been moved."
      icon={<Search size={32} />}
    />
  );
};

export default NotFound;
