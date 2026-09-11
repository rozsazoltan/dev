//! Shared configuration and standard paths for the `dev` workspace.

use std::{
    env,
    error::Error,
    fmt, fs, io,
    path::{Path, PathBuf},
};

use serde::Deserialize;

#[derive(Debug)]
pub enum ConfigError {
    LocalAppDataMissing,
    MissingDefaultWsl,
    InvalidIdentifier(String),
    Read {
        path: PathBuf,
        source: io::Error,
    },
    Parse {
        path: PathBuf,
        source: toml::de::Error,
    },
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::LocalAppDataMissing => write!(formatter, "LOCALAPPDATA is not set"),
            Self::MissingDefaultWsl => write!(formatter, "a default WSL distro must be configured"),
            Self::InvalidIdentifier(identifier) => {
                write!(formatter, "invalid resource identifier {identifier:?}")
            }
            Self::Read { path, .. } => {
                write!(formatter, "failed to read configuration file {path:?}")
            }
            Self::Parse { path, .. } => write!(formatter, "invalid configuration file {path:?}"),
        }
    }
}

impl Error for ConfigError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Read { source, .. } => Some(source),
            Self::Parse { source, .. } => Some(source),
            Self::LocalAppDataMissing | Self::MissingDefaultWsl | Self::InvalidIdentifier(_) => {
                None
            }
        }
    }
}

#[derive(Default, Deserialize)]
struct FileConfig {
    root: Option<PathBuf>,
    #[serde(default)]
    wsl: WslConfig,
}

#[derive(Default, Deserialize)]
struct WslConfig {
    default: Option<String>,
}

pub struct Config {
    root: PathBuf,
    default_wsl: Option<String>,
}

impl Config {
    pub fn load() -> Result<Self, ConfigError> {
        let local_app_data = env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .ok_or(ConfigError::LocalAppDataMissing)?;
        Self::load_from_path(
            &local_app_data.join("dev").join("config.toml"),
            &local_app_data,
        )
    }

    pub fn load_from_path(config_path: &Path, local_app_data: &Path) -> Result<Self, ConfigError> {
        let file_config = match fs::read_to_string(config_path) {
            Ok(contents) => toml::from_str(&contents).map_err(|source| ConfigError::Parse {
                path: config_path.to_path_buf(),
                source,
            })?,
            Err(source) if source.kind() == io::ErrorKind::NotFound => FileConfig::default(),
            Err(source) => {
                return Err(ConfigError::Read {
                    path: config_path.to_path_buf(),
                    source,
                });
            }
        };

        Ok(Self {
            root: file_config
                .root
                .unwrap_or_else(|| local_app_data.join("dev").join("data")),
            default_wsl: file_config.wsl.default,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn disks_dir(&self) -> PathBuf {
        self.root.join("disks")
    }

    pub fn distros_dir(&self) -> PathBuf {
        self.root.join("wsl").join("distros")
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.root.join("wsl").join("backups")
    }

    pub fn tmp_dir(&self) -> PathBuf {
        self.root.join("tmp")
    }

    pub fn require_default_wsl(&self) -> Result<&str, ConfigError> {
        self.default_wsl
            .as_deref()
            .ok_or(ConfigError::MissingDefaultWsl)
    }
}

pub fn validate_identifier(identifier: &str) -> Result<&str, ConfigError> {
    if identifier.is_empty() || matches!(identifier, "." | "..") || identifier.contains(['/', '\\'])
    {
        return Err(ConfigError::InvalidIdentifier(identifier.to_owned()));
    }

    Ok(identifier)
}
