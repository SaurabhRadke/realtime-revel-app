import Controller from "./Controller";

export const metadata = {
  title: "Controller · The Old Ground",
  description: "Phone controller: joystick to walk, point the phone to aim the torch.",
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
