import { Application } from "/vendor/hotwired/stimulus.js";
import SessionsController from "./controllers/sessions-controller.js";

const application = Application.start();
application.debug = false;
application.register("sessions", SessionsController);

window.OverlordStimulus = application;

export { application };
