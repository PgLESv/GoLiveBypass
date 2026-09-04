<script setup lang="ts">
import { downloads, githubReleasePageUrl, release } from '~/data/release'
import { terminalCommands } from '~/data/install'
import type { Platform } from '~/components/PlatformTabs.vue'

useSeoMeta({
  title: 'Downloads',
  description:
    'Baixe a GUI WireGuard do GoLiveBypass para Windows ou Linux.',
  ogTitle: 'Downloads — GoLiveBypass',
  ogDescription: 'Escolha a GUI ou copie o comando de instalação para a sua plataforma.',
  ogUrl: 'https://golivebypass.dev/downloads',
})

const selectedPlatform = ref<Platform>('windows')
const commandPlatform = ref<Platform>('windows')

const activeTerminalCommands = computed(() => terminalCommands[commandPlatform.value === 'linux' ? 'linux' : 'windows'])

onMounted(() => {
  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('mac')) {
    selectedPlatform.value = 'macos'
    commandPlatform.value = 'macos'
  }
  if (userAgent.includes('linux')) {
    selectedPlatform.value = 'linux'
    commandPlatform.value = 'linux'
  }
})
</script>

<template>
  <div class="page-wrap site-container">
    <PageIntro
      eyebrow="BAIXAR O PROJETO"
      title="Escolha a ferramenta para a sua máquina."
      description="A GUI vem diretamente da release do GitHub. Para terminal, standalone e plugin, copie o comando oficial correspondente ao seu sistema."
    />

    <section id="gui" class="release-banner reveal reveal--first">
      <div class="release-banner__copy">
        <span class="release-banner__label"><span class="status-dot" aria-hidden="true"></span> Release estável</span>
        <h2>GoLiveBypass <code>v{{ release.version }}</code></h2>
        <p>A GUI 2.0.0 é a única variante disponível nesta release.</p>
      </div>
      <a class="text-link" :href="githubReleasePageUrl" target="_blank" rel="noopener noreferrer">
        Ver release no GitHub
        <BaseIcon name="external" :size="16" />
      </a>
    </section>

    <section class="section section--page-section reveal reveal--second" aria-labelledby="gui-title">
      <div class="section-heading section-heading--compact">
        <div>
          <span class="eyebrow">INTERFACE GRÁFICA</span>
          <h2 id="gui-title">Baixe a GUI</h2>
        </div>
        <p>Escolhemos uma sugestão com base no seu navegador. Windows e Linux estão disponíveis.</p>
      </div>

      <PlatformTabs v-model="selectedPlatform" />

      <div v-if="selectedPlatform === 'windows'" id="platform-panel-windows" class="platform-panel" role="tabpanel" aria-labelledby="platform-tab-windows">
        <DownloadCard
          icon="windows"
          kicker="WINDOWS"
          title="Aplicativo para Windows"
          description="Abra o executável, escolha a configuração e deixe a GUI cuidar da ativação do Discord."
          :meta="`GoLiveBypass-${release.version}.exe · release ${release.channel}`"
          primary-label="Baixar para Windows"
          :primary-href="downloads.windowsGui"
          secondary-label="Abrir release"
          :secondary-href="githubReleasePageUrl"
          tone="success"
        />
        <div class="platform-note">
          <BaseIcon name="alert" :size="17" />
          <p>O Windows pode exibir um aviso do SmartScreen na primeira abertura. A release também está disponível no GitHub para conferência.</p>
        </div>
      </div>

      <div v-else-if="selectedPlatform === 'macos'" id="platform-panel-macos" class="platform-panel" role="tabpanel" aria-labelledby="platform-tab-macos">
        <div class="platform-note">
          <BaseIcon name="lock" :size="17" />
          <p>macOS está temporariamente indisponível. A 2.0.0 não usa injeção nem PAC.</p>
        </div>
      </div>

      <div v-else id="platform-panel-linux" class="platform-panel" role="tabpanel" aria-labelledby="platform-tab-linux">
        <DownloadCard
          icon="linux"
          kicker="LINUX"
          title="AppImage para Linux"
          description="Um arquivo portátil para Debian, Ubuntu, Fedora, Arch e outras distribuições compatíveis."
          :meta="`GoLiveBypass-${release.version}.AppImage · release ${release.channel}`"
          primary-label="Baixar AppImage"
          :primary-href="downloads.linuxGui"
          secondary-label="Ver instruções"
          secondary-href="/instalacao#gui-linux"
        />
        <div class="platform-note">
          <BaseIcon name="terminal" :size="17" />
          <p>Depois do download, dê permissão de execução com <code>chmod +x GoLiveBypass-*.AppImage</code>.</p>
        </div>
      </div>
    </section>

    <section class="section section--page-section reveal reveal--third" aria-labelledby="command-title">
      <div class="section-heading">
        <div>
          <span class="eyebrow">INSTALAÇÃO POR COMANDO</span>
          <h2 id="command-title">Copie e cole no terminal.</h2>
        </div>
        <p>Os instaladores de terminal, standalone e plugin estão temporariamente fora de serviço.</p>
      </div>

      <div class="info-note command-platform-unavailable" role="status">
        <span class="icon-frame icon-frame--muted"><BaseIcon name="apple" :size="18" /></span>
        <div>
          <strong>Use a GUI 2.0.0.</strong>
          <p>Plugin, standalone e instaladores de terminal estão pausados durante a portabilidade para WireGuard.</p>
        </div>
      </div>

      <div class="command-section-footnote">
        <span class="icon-frame icon-frame--muted"><BaseIcon name="lock" :size="17" /></span>
        <div>
          <strong>O comando roda os scripts oficiais do repositório.</strong>
          <p>Não execute os scripts antigos; eles não fazem parte da release 2.0.0.</p>
        </div>
      </div>
    </section>

    <section class="info-note reveal reveal--third">
      <span class="icon-frame icon-frame--muted"><BaseIcon name="lock" :size="18" /></span>
      <div>
        <strong>Links e comandos sem API do GitHub</strong>
        <p>A página usa links estáticos para a release e para os scripts oficiais. Se uma versão mudar, a tag, os assets e os comandos ficam centralizados nos arquivos de dados do site.</p>
      </div>
    </section>

    <div class="section section--last">
      <DiscordCta />
    </div>
  </div>
</template>
