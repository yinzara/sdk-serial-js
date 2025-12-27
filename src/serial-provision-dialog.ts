import { LitElement, html, PropertyValues, css, TemplateResult } from "lit";
import { customElement, query, property, state } from "lit/decorators.js";
import "@material/web/dialog/dialog.js";
import "@material/web/iconbutton/filled-tonal-icon-button.js";
import "@material/web/iconbutton/outlined-icon-button.js";
import "@material/web/iconbutton/icon-button.js";
import "@material/web/textfield/outlined-text-field.js";
import "@material/web/button/outlined-button.js";
import "@material/web/button/filled-button.js";
import "@material/web/progress/circular-progress.js";
import "@material/web/select/outlined-select.js";
import "@material/web/select/select-option.js";
import "@material/web/list/list.js";
import "@material/web/list/list-item.js";
import "@material/web/icon/icon.js";

import type { MdOutlinedTextField } from "@material/web/textfield/outlined-text-field";
import type { MdOutlinedSelect } from "@material/web/select/outlined-select.js";

import {
  ImprovSerialCurrentState,
  ImprovSerialErrorState,
  Logger,
  State,
} from "./const.js";
import { ImprovSerial, Ssid } from "./serial.js";
import { fireEvent } from "./util/fire-event";

const ERROR_ICON = "⚠️";
const OK_ICON = "🎉";
const MATERIAL_SYMBOLS_FONT_ID = "material-symbols-font";
const MATERIAL_SYMBOLS_FONT_URL =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined";

function getWifiIconName(rssi: number): string {
  if (rssi >= -50) return "network_wifi";
  if (rssi >= -60) return "network_wifi_3_bar";
  if (rssi >= -70) return "network_wifi_2_bar";
  return "network_wifi_1_bar";
}

function getSignalStrengthClass(rssi: number): string {
  if (rssi >= -50) return "signal-excellent";
  if (rssi >= -60) return "signal-good";
  if (rssi >= -70) return "signal-fair";
  return "signal-weak";
}

@customElement("improv-wifi-serial-provision-dialog")
class SerialProvisionDialog extends LitElement {
  @property() public port?: SerialPort;

  public logger: Logger = console;

  public learnMoreUrl?: TemplateResult;

  @state() private _state: State = "CONNECTING";

  @state() private _client?: ImprovSerial;

  @state() private _busy = false;

  @state() private _error?: string | TemplateResult;

  @state() private _hasProvisioned = false;

  @state() private _selectedSsid: string | null = null;

  // undefined = not loaded
  // null = not available
  @state() private _ssids?: Ssid[] | null;

  @state() private _showPassword = false;

  @query("md-outlined-select") private _selectSSID!: MdOutlinedSelect;
  @query("md-outlined-text-field[name=ssid]")
  private _inputSSID!: MdOutlinedTextField;
  @query("md-outlined-text-field[name=password]")
  private _inputPassword?: MdOutlinedTextField;

  connectedCallback() {
    super.connectedCallback();
    if (!document.getElementById(MATERIAL_SYMBOLS_FONT_ID)) {
      const link = document.createElement("link");
      link.id = MATERIAL_SYMBOLS_FONT_ID;
      link.rel = "stylesheet";
      link.href = MATERIAL_SYMBOLS_FONT_URL;
      document.head.appendChild(link);
    }
  }

  protected render() {
    if (!this.port) {
      return html``;
    }
    let heading: TemplateResult = html`${this._client?.info?.name ?? ""}`;
    let content: TemplateResult;
    let actions: TemplateResult | undefined;

    if (this._state === "CONNECTING") {
      content = this._renderProgress("Connecting");
    } else if (this._state === "ERROR") {
      content = this._renderMessage(
        ERROR_ICON,
        `An error occurred. ${this._error}`,
      );
      actions = this._renderCloseAction();
    } else if (this._client!.state === ImprovSerialCurrentState.READY) {
      if (this._busy) {
        content = this._renderProgress("Provisioning");
      } else {
        heading = html`<md-filled-tonal-icon-button
            ><md-icon>wifi</md-icon></md-filled-tonal-icon-button
          >Configure Wi-Fi`;
        content = this._renderImprovReady();
        actions = html`${this._renderCloseAction()}
          <md-filled-button @click=${this._provision}
            >Connect</md-filled-button
          > `;
      }
    } else if (this._client!.state === ImprovSerialCurrentState.PROVISIONING) {
      content = this._renderProgress("Provisioning");
    } else if (this._client!.state === ImprovSerialCurrentState.PROVISIONED) {
      content = this._renderImprovDashboard();
      actions =
        this._client!.nextUrl === undefined
          ? this._renderCloseAction()
          : html`${this._renderCloseAction()}
              <md-filled-button href=${this._client!.nextUrl} form="improv-form"
                >Next</md-filled-button
              >`;
    } else {
      content = this._renderMessage(
        ERROR_ICON,
        `Unexpected state: ${this._state} - ${this._client!.state}`,
      );
      actions = this._renderCloseAction();
    }

    return html`
      <md-dialog open @close=${this._handleClose}>
        <div slot="headline">${heading}</div>
        <form slot="content" id="improv-form" method="dialog">${content}</form>
        ${actions ? html`<div slot="actions">${actions}</div>` : ""}
      </md-dialog>
    `;
  }

  _renderCloseAction() {
    return html`<md-outlined-button
      form="improv-form"
      @click=${this._handleClose}
      >Close</md-outlined-button
    >`;
  }

  _renderProgress(label: string) {
    return html`
      <div class="center">
        <div>
          <md-circular-progress indeterminate></md-circular-progress>
        </div>
        ${label}
      </div>
    `;
  }

  _renderMessage(icon: string, label: string) {
    return html`
      <div class="center">
        <div class="icon">${icon}</div>
        ${label}
      </div>
    `;
  }

  _renderImprovReady() {
    let error: string | undefined;

    switch (this._client!.error) {
      case ImprovSerialErrorState.UNABLE_TO_CONNECT:
        error = "Unable to connect";
        break;

      case ImprovSerialErrorState.NO_ERROR:
        break;

      // Happens after scanning for networks if device
      // doesn't support the command.
      case ImprovSerialErrorState.UNKNOWN_RPC_COMMAND:
        if (this._ssids !== null) {
          error = `Unknown RPC command`;
        }
        break;

      case ImprovSerialErrorState.TIMEOUT:
        error = `Timeout`;
        break;

      default:
        error = `Unknown error (${this._client!.error})`;
    }

    const selectedSsid = this._ssids?.find(
      (info) => info.name === this._selectedSsid,
    );

    return html`
      <div>
        Enter the credentials of the Wi-Fi network that you want your device to
        connect to.
      </div>
      ${this._client?.info ? this._renderDeviceInfo() : ""}
      ${error ? html`<p class="error">${error}</p>` : ""}
      ${this._ssids !== null
        ? html`
            <div class="network-select">
              <md-outlined-select
                name="ssid_select"
                required
                label="Network"
                @change=${(ev: Event) => {
                  const index = (ev.target as MdOutlinedSelect).selectedIndex;
                  // The "Join Other" item is always the last item.
                  this._selectedSsid =
                    index === this._ssids!.length
                      ? null
                      : this._ssids![index].name;
                }}
                @closed=${(ev: Event) => ev.stopPropagation()}
              >
                ${this._ssids!.map(
                  (info, idx) => html`
                    <md-select-option
                      .selected=${selectedSsid === info}
                      value=${idx}
                    >
                      <md-icon
                        slot="start"
                        class=${getSignalStrengthClass(info.rssi)}
                        >${getWifiIconName(info.rssi)}</md-icon
                      >
                      <span slot="headline">${info.name}</span>
                      <span slot="end" class="network-details">
                        <span class="signal-strength">${info.rssi}dB</span>
                        <md-icon
                          class="lock-icon ${info.secured
                            ? "lock-secured"
                            : "lock-unsecured"}"
                          >${info.secured ? "lock" : "lock_open"}</md-icon
                        >
                      </span>
                    </md-select-option>
                  `,
                )}
                <md-select-option .selected=${!selectedSsid} value="-1">
                  Join other…
                </md-select-option>
              </md-outlined-select>

              <md-outlined-icon-button @click=${this._updateSsids} data-refresh>
                <md-icon>refresh</md-icon>
              </md-outlined-icon-button>
            </div>
          `
        : ""}
      ${
        // Show input box if command not supported or "Join Other" selected
        this._ssids === null || this._selectedSsid === null
          ? html`
              <md-outlined-text-field
                required
                label="Network Name"
                name="ssid"
              ></md-outlined-text-field>
            `
          : ""
      }
      ${
        // Show password if custom SSID or needs password
        !selectedSsid || selectedSsid.secured
          ? html`
              <md-outlined-text-field
                required
                label="Password"
                name="password"
                type=${this._showPassword ? "text" : "password"}
              >
                <md-icon-button
                  slot="trailing-icon"
                  @click=${this._togglePasswordVisibility}
                  toggle
                  .selected=${this._showPassword}
                >
                  <md-icon
                    >${this._showPassword
                      ? "visibility_off"
                      : "visibility"}</md-icon
                  >
                </md-icon-button>
              </md-outlined-text-field>
            `
          : ""
      }
    `;
  }

  _renderDeviceInfo(): TemplateResult {
    return html`<div class="device-info">
      <div><md-icon>info</md-icon>Device Info</div>
      <div>Name<span>${this._client!.info!.name}</span></div>
      <div>Firmware<span>${this._client!.info!.firmware}</span></div>
      <div>Version<span>${this._client!.info!.version}</span></div>
      <div>Chip<span>${this._client!.info!.chipFamily}</span></div>
    </div>`;
  }

  _renderImprovDashboard(): TemplateResult {
    return html`
      ${this._renderDeviceInfo()}
      ${this._hasProvisioned
        ? html`
            <div class="center">
              <div class="icon">${OK_ICON}</div>
              Provisioned!
            </div>
          `
        : ""}
    `;
  }

  private _togglePasswordVisibility(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this._showPassword = !this._showPassword;
  }

  private async _updateSsids(event: Event | undefined = undefined) {
    event?.preventDefault();
    const oldSsids = this._ssids;
    this._ssids = undefined;
    this._busy = true;

    let ssids: Ssid[];

    try {
      ssids = await this._client!.scan();
    } catch (err) {
      // When we fail on first load, pick "Join other"
      if (this._ssids === undefined) {
        this._ssids = null;
        this._selectedSsid = null;
      }
      this._busy = false;
      return;
    }

    if (oldSsids) {
      // If we had a previous list, ensure the selection is still valid
      if (
        this._selectedSsid &&
        !ssids.find((s) => s.name === this._selectedSsid)
      ) {
        this._selectedSsid = ssids[0].name;
      }
    } else {
      this._selectedSsid = ssids.length ? ssids[0].name : null;
    }

    this._ssids = ssids;
    this._busy = false;
  }

  private async _provision() {
    this._busy = true;
    try {
      await this._client!.provision(
        this._selectedSsid === null
          ? this._inputSSID.value
          : this._selectedSsid,
        this._inputPassword?.value || "",
        30000, // Timeout in 30 seconds
      );
      this._hasProvisioned = true;
    } catch (err) {
      // No need to do error handling because we listen for `error-changed` events
      console.log(err);
    } finally {
      this._busy = false;
    }
  }

  protected updated(changedProps: PropertyValues) {
    super.updated(changedProps);

    if (changedProps.has("port") && this.port) {
      this._connect();
    }

    let toFocus: LitElement | undefined;

    if (changedProps.has("_ssids") && this._ssids !== undefined) {
      toFocus = this._selectSSID;
    } else if (
      changedProps.has("_selectedSsid") &&
      this._selectedSsid === null
    ) {
      toFocus = this._inputSSID;
    }

    if (toFocus) {
      toFocus.updateComplete.then(() => toFocus!.focus());
    }
  }

  private async _connect() {
    let client: ImprovSerial;
    try {
      client = new ImprovSerial(this.port!, this.logger);
    } catch (err) {
      this._state = "ERROR";
      this._error = (err as any).message || err || "Unknown error";
      return;
    }
    client.addEventListener("state-changed", () => {
      this._state = "IMPROV-STATE";
      this.requestUpdate();
    });
    client.addEventListener("error-changed", () => this.requestUpdate());
    try {
      await client.initialize();
    } catch (err: any) {
      this._state = "ERROR";
      this._error = this.learnMoreUrl
        ? html`
            Unable to detect Improv service on connected device.
            <a href=${this.learnMoreUrl} target="_blank"
              >Learn how to resolve this</a
            >
          `
        : err.message;
      return;
    }
    client.addEventListener("disconnect", () => {
      this._state = "ERROR";
      this._error = "Disconnected";
    });
    if (client.nextUrl) {
      this.requestUpdate();
    }
    this._client = client;
    try {
      await this._updateSsids(); // do an initial scan since we're showing the dialog immediately
    } catch (err: any) {
      console.error("Unable to update SSIDs", err);
    }
  }

  private async _handleClose() {
    const eventData = {
      improv: false,
      provisioned: false,
    };
    if (this._client) {
      eventData.improv = true;
      eventData.provisioned =
        this._client.state === ImprovSerialCurrentState.PROVISIONED;
      await this._client?.close();
      this._client = undefined;
    }
    fireEvent(this, "closed" as any, eventData);
    this.parentNode!.removeChild(this);
  }

  static styles = css`
    :host {
      --md-dialog-max-width: 390px;
      --md-dialog-container-max-block-size: none !important;
      --md-sys-color-primary: var(--improv-primary-color, #03a9f4);
      --md-sys-color-on-primary: var(--improv-on-primary-color, #fff);
    }

    md-dialog {
      --md-dialog-container-max-block-size: none !important;
      max-height: 90vh !important;
    }

    md-dialog [slot="content"],
    form[slot="content"] {
      overflow: visible !important;
      max-height: none !important;
    }

    md-outlined-text-field,
    md-outlined-select {
      display: block;
      margin-top: 16px;
    }

    .center {
      text-align: center;
    }

    md-circular-progress {
      margin-bottom: 16px;
    }

    a.has-button {
      text-decoration: none;
    }

    .icon {
      font-size: 50px;
      line-height: 80px;
      color: black;
    }

    .error {
      color: #db4437;
    }

    .device-info {
      margin-top: 16px;
      padding: 16px;
      background-color: #d6d6d6;
      border-radius: 8px;
      border: 1px solid #676767;
    }

    .device-info > div:first-child {
      justify-content: flex-start;
      align-items: center;
      gap: 8px;
    }

    .device-info > div {
      display: flex;
      color: #5f6368;
      justify-content: space-between;
    }

    .device-info > div > span {
      color: #1f1f1f;
    }

    md-select-option[value="-1"] {
      border-top: 1px solid #ccc;
    }
    md-outlined-select[name="ssid_select"] {
      width: 100%;
    }

    .network-select {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      margin-top: 16px;
    }

    .network-select md-outlined-icon-button {
      margin-bottom: 8px;
    }

    .network-details {
      display: flex;
      align-items: center;
      gap: 4px;
      color: #5f6368;
      font-size: 0.85em;
    }

    .signal-strength {
      min-width: 45px;
      text-align: right;
    }

    .lock-icon {
      font-size: 18px;
    }

    .lock-secured {
      color: #34a853;
    }

    .lock-unsecured {
      color: #ea4335;
    }

    .signal-excellent {
      color: #34a853;
    }

    .signal-good {
      color: #4285f4;
    }

    .signal-fair {
      color: #fbbc04;
    }

    .signal-weak {
      color: #ea4335;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "improv-wifi-serial-provision-dialog": SerialProvisionDialog;
  }
}
