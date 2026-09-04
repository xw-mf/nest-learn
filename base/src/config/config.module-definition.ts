import { ConfigurableModuleBuilder} from '@nestjs/common'
import { ConfigModuleOptions } from './interface/config-module-options.interface.js'

export const {
	ConfigurableModuleClass,
	MODULE_OPTIONS_TOKEN
} = new ConfigurableModuleBuilder<ConfigModuleOptions>()
	.setExtras(
		{ isGlobal: true },
		(definition, extras) => ({
			...definition,
			global: extras.isGlobal,
		})
	)
	.build();