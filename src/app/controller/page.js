import Controller from "./Controller";

export const metadata = {
  title: "Controller · Lanterns & Keys",
  description: "Phone controller: joystick to walk, point the phone like a torch to find the hidden keys.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#05070d",
};

export default function ControllerPage() {
  return <Controller />;
}
