﻿import { EOL } from "os";

export abstract class DebugPlatformCommand implements ICommand {
	public allowedParameters: ICommandParameter[] = [];
	public platform: string;

	constructor(private debugService: IPlatformDebugService,
		private $devicesService: Mobile.IDevicesService,
		private $debugDataService: IDebugDataService,
		protected $platformService: IPlatformService,
		protected $projectData: IProjectData,
		protected $options: IOptions,
		protected $platformsData: IPlatformsData,
		protected $logger: ILogger,
		private $debugLiveSyncService: ILiveSyncService,
		private $config: IConfiguration) {
		this.$projectData.initializeProjectData();
	}

	public async execute(args: string[]): Promise<void> {
		const debugOptions = this.$options;

		let debugData = this.$debugDataService.createDebugData(this.$projectData, this.$options);

		await this.$platformService.trackProjectType(this.$projectData);

		if (this.$options.start) {
			return this.printDebugInformation(await this.debugService.debug<string[]>(debugData, debugOptions));
		}

		this.$config.debugLivesync = true;

		// TODO: Fix this call
		await this.$devicesService.initialize({ deviceId: this.$options.device, platform: this.platform, skipDeviceDetectionInterval: true, skipInferPlatform: true });
		await this.$devicesService.detectCurrentlyAttachedDevices();

		const devices = this.$devicesService.getDeviceInstances();
		// Now let's take data for each device:
		const deviceDescriptors: ILiveSyncDeviceInfo[] = devices.filter(d => !this.platform || d.deviceInfo.platform === this.platform)
			.map(d => {
				const info: ILiveSyncDeviceInfo = {
					identifier: d.deviceInfo.identifier,
					buildAction: async (): Promise<string> => {
						const buildConfig: IBuildConfig = {
							buildForDevice: !d.isEmulator, // this.$options.forDevice,
							projectDir: this.$options.path,
							clean: this.$options.clean,
							teamId: this.$options.teamId,
							device: this.$options.device,
							provision: this.$options.provision,
							release: this.$options.release,
							keyStoreAlias: this.$options.keyStoreAlias,
							keyStorePath: this.$options.keyStorePath,
							keyStoreAliasPassword: this.$options.keyStoreAliasPassword,
							keyStorePassword: this.$options.keyStorePassword
						};

						await this.$platformService.buildPlatform(d.deviceInfo.platform, buildConfig, this.$projectData);
						const pathToBuildResult = await this.$platformService.lastOutputPath(d.deviceInfo.platform, buildConfig, this.$projectData);
						return pathToBuildResult;
					}
				};

				return info;
			});

		const liveSyncInfo: ILiveSyncInfo = {
			projectDir: this.$projectData.projectDir,
			skipWatcher: !this.$options.watch || this.$options.justlaunch,
			watchAllFiles: this.$options.syncAllFiles
		};

		await this.$debugLiveSyncService.liveSync(deviceDescriptors, liveSyncInfo);
	}

	public async canExecute(args: string[]): Promise<boolean> {
		await this.$devicesService.initialize({ platform: this.debugService.platform, deviceId: this.$options.device });
		// Start emulator if --emulator is selected or no devices found.
		if (this.$options.emulator || this.$devicesService.deviceCount === 0) {
			return true;
		}

		if (this.$devicesService.deviceCount > 1) {
			// Starting debugger on emulator.
			this.$options.emulator = true;

			this.$logger.warn("Multiple devices found! Starting debugger on emulator. If you want to debug on specific device please select device with --device option.".yellow.bold);
		}

		return true;
	}

	protected printDebugInformation(information: string[]): void {
		_.each(information, i => {
			this.$logger.info(`To start debugging, open the following URL in Chrome:${EOL}${i}${EOL}`.cyan);
		});
	}
}

export class DebugIOSCommand extends DebugPlatformCommand {
	constructor(private $errors: IErrors,
		private $devicePlatformsConstants: Mobile.IDevicePlatformsConstants,
		$logger: ILogger,
		$iOSDebugService: IPlatformDebugService,
		$devicesService: Mobile.IDevicesService,
		$config: IConfiguration,
		$debugDataService: IDebugDataService,
		$platformService: IPlatformService,
		$options: IOptions,
		$projectData: IProjectData,
		$platformsData: IPlatformsData,
		$iosDeviceOperations: IIOSDeviceOperations,
		$debugLiveSyncService: ILiveSyncService) {
		super($iOSDebugService, $devicesService, $debugDataService, $platformService, $projectData, $options, $platformsData, $logger, $debugLiveSyncService, $config);
		// Do not dispose ios-device-lib, so the process will remain alive and the debug application (NativeScript Inspector or Chrome DevTools) will be able to connect to the socket.
		// In case we dispose ios-device-lib, the socket will be closed and the code will fail when the debug application tries to read/send data to device socket.
		// That's why the `$ tns debug ios --justlaunch` command will not release the terminal.
		// In case we do not set it to false, the dispose will be called once the command finishes its execution, which will prevent the debugging.
		$iosDeviceOperations.setShouldDispose(false);
	}

	public async canExecute(args: string[]): Promise<boolean> {
		if (!this.$platformService.isPlatformSupportedForOS(this.$devicePlatformsConstants.iOS, this.$projectData)) {
			this.$errors.fail("Applications for platform %s can not be built on this OS - %s", this.$devicePlatformsConstants.iOS, process.platform);
		}

		return await super.canExecute(args) && await this.$platformService.validateOptions(this.$options.provision, this.$projectData, this.$platformsData.availablePlatforms.iOS);
	}

	protected printDebugInformation(information: string[]): void {
		if (this.$options.chrome) {
			super.printDebugInformation(information);
		}
	}

	public platform = "iOS";
}

$injector.registerCommand("debug|ios", DebugIOSCommand);

export class DebugAndroidCommand extends DebugPlatformCommand {
	constructor(private $errors: IErrors,
		private $devicePlatformsConstants: Mobile.IDevicePlatformsConstants,
		$logger: ILogger,
		$androidDebugService: IPlatformDebugService,
		$devicesService: Mobile.IDevicesService,
		$config: IConfiguration,
		$debugDataService: IDebugDataService,
		$platformService: IPlatformService,
		$options: IOptions,
		$projectData: IProjectData,
		$platformsData: IPlatformsData,
		$debugLiveSyncService: ILiveSyncService) {
		super($androidDebugService, $devicesService, $debugDataService, $platformService, $projectData, $options, $platformsData, $logger, $debugLiveSyncService, $config);
	}

	public async canExecute(args: string[]): Promise<boolean> {
		if (!this.$platformService.isPlatformSupportedForOS(this.$devicePlatformsConstants.Android, this.$projectData)) {
			this.$errors.fail("Applications for platform %s can not be built on this OS - %s", this.$devicePlatformsConstants.Android, process.platform);
		}

		return await super.canExecute(args) && await this.$platformService.validateOptions(this.$options.provision, this.$projectData, this.$platformsData.availablePlatforms.Android);
	}

	public platform = "Android";
}

$injector.registerCommand("debug|android", DebugAndroidCommand);
